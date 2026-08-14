import { lstat, mkdtemp, open, realpath, rm } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { CanvasFile } from './types.js';
import { CanvasError } from './errors.js';
import { htmlToReadableText } from '../format/html.js';

export type InlineFile = {
  kind: 'inline';
  name: string;
  mimeType: string;
  text: string;
};

export type DownloadedFile = {
  kind: 'downloaded';
  name: string;
  mimeType: string;
  path: string;
  size: number;
};

export type TemporaryDirectoryFactory = (prefix: string) => Promise<string>;
export type DirectoryRemover = (directory: string) => Promise<void>;

export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export type HostnameResolver = (
  hostname: string,
) => Promise<readonly ResolvedAddress[]>;

export interface ExternalRequestOptions {
  readonly method: 'GET';
  readonly redirect: 'manual';
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  readonly addresses: readonly ResolvedAddress[];
}

export type ExternalTransport = (
  url: URL,
  options: ExternalRequestOptions,
) => Promise<Response>;

export interface DownloadOptions {
  readonly canvasOrigin: URL;
  readonly apiToken: string;
  readonly fetchImpl?: typeof fetch;
  readonly createTempDirectory?: TemporaryDirectoryFactory;
  readonly timeoutMs?: number;
  readonly resolveHostname?: HostnameResolver;
  readonly externalTransport?: ExternalTransport;
  readonly removeDirectory?: DirectoryRemover;
}

const INLINE_BYTE_LIMIT = 256 * 1024;
const INLINE_CHARACTER_LIMIT = 100_000;
const DOWNLOAD_BYTE_LIMIT = 25 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 15_000;
const TEMP_DIRECTORY_PREFIX = 'mcp-server-canvas-lms-';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BLOCKED_ADDRESSES = createBlockedAddressList();

interface ExternalTarget {
  readonly hostname: string;
  readonly addresses: readonly ResolvedAddress[];
}

interface TrackedDirectory {
  readonly removeDirectory: DirectoryRemover;
}

const trackedDirectories = new Map<string, TrackedDirectory>();

function cleanupTrackedDirectoriesAtExit(): void {
  for (const directory of trackedDirectories.keys()) {
    try {
      rmSync(directory, { recursive: true, force: true });
      trackedDirectories.delete(directory);
    } catch {
      // Process exit cannot await a retry; never leak filesystem details.
    }
  }
}

export async function downloadCanvasFile(
  file: CanvasFile,
  options: DownloadOptions,
): Promise<InlineFile | DownloadedFile> {
  const url = initialDownloadUrl(file, options.canvasOrigin);
  let directory: string | undefined;

  try {
    const response = await fetchDownload(url, options);
    assertContentLengthWithinLimit(response.headers.get('content-length'));

    const mimeType = file.content_type ?? 'application/octet-stream';
    if (canReadInline(file, mimeType)) {
      const bytes = await readResponseBytes(response);
      const text = decodeUtf8(bytes);
      if (bytes.byteLength <= INLINE_BYTE_LIMIT && text !== undefined) {
        return {
          kind: 'inline',
          name: displayName(file),
          mimeType,
          text: isHtmlMimeType(mimeType)
            ? htmlToReadableText(text)
            : text.slice(0, INLINE_CHARACTER_LIMIT),
        };
      }

      directory = await createDownloadDirectory(
        options.createTempDirectory,
        options.removeDirectory,
      );
      const name = safeFilename(file);
      const path = join(directory, name);
      await writeBytes(path, bytes);
      return { kind: 'downloaded', name, mimeType, path, size: bytes.length };
    }

    directory = await createDownloadDirectory(
      options.createTempDirectory,
      options.removeDirectory,
    );
    const name = safeFilename(file);
    const path = join(directory, name);
    const size = await streamResponseToFile(response, path);
    return { kind: 'downloaded', name, mimeType, path, size };
  } catch (error) {
    if (directory) {
      try {
        await removeTrackedDirectory(directory);
      } catch {
        // Keep the directory tracked for cleanupDownloads or process exit.
      }
    }
    if (error instanceof CanvasError) throw error;
    throw new CanvasError('NETWORK', 'Canvas file download failed');
  }
}

export async function cleanupDownloads(): Promise<void> {
  let cleanupFailed = false;
  for (const directory of [...trackedDirectories.keys()]) {
    try {
      await removeTrackedDirectory(directory);
    } catch {
      cleanupFailed = true;
    }
  }
  if (cleanupFailed) {
    throw new CanvasError(
      'BAD_RESPONSE',
      'Unable to clean up temporary Canvas downloads',
    );
  }
}

function initialDownloadUrl(file: CanvasFile, canvasOrigin: URL): URL {
  let url: URL;
  try {
    if (!file.url) throw new Error('Missing URL');
    url = new URL(file.url);
  } catch {
    throw new CanvasError(
      'UNSAFE_URL',
      'Canvas file has an unsafe download URL',
    );
  }
  if (
    url.protocol !== 'https:' ||
    url.origin !== canvasOrigin.origin ||
    url.username ||
    url.password
  ) {
    throw new CanvasError(
      'UNSAFE_URL',
      'Canvas file has an unsafe download URL',
    );
  }
  return url;
}

async function fetchDownload(
  initialUrl: URL,
  options: DownloadOptions,
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  let url = initialUrl;
  let externalTarget: ExternalTarget | undefined;
  let redirectCount = 0;

  for (;;) {
    let response: Response;
    try {
      const headers: Record<string, string> = { Accept: '*/*' };
      if (externalTarget === undefined) {
        headers.Authorization = `Bearer ${options.apiToken}`;
        response = await fetchImpl(url.href, {
          method: 'GET',
          redirect: 'manual',
          headers,
          signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        });
      } else {
        response = await (
          options.externalTransport ?? defaultExternalTransport
        )(url, {
          method: 'GET',
          redirect: 'manual',
          headers,
          signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
          addresses: externalTarget.addresses,
        });
      }
    } catch {
      throw new CanvasError('NETWORK', 'Canvas file download failed');
    }

    if (!REDIRECT_STATUSES.has(response.status)) {
      if (!response.ok) {
        throw new CanvasError(
          'BAD_RESPONSE',
          `Canvas file download returned status ${String(response.status)}`,
        );
      }
      return response;
    }

    if (redirectCount >= MAX_REDIRECTS) {
      throw new CanvasError(
        'UNSAFE_URL',
        'Canvas file download returned too many redirects',
      );
    }
    redirectCount += 1;
    const redirected = redirectUrl(response.headers.get('location'), url);
    await discardResponseBody(response);

    if (externalTarget !== undefined) {
      if (normalizedHostname(redirected) !== externalTarget.hostname) {
        throw unsafeRedirectError();
      }
      assertSafeExternalUrl(redirected);
    } else if (redirected.origin !== options.canvasOrigin.origin) {
      assertSafeExternalUrl(redirected);
      const hostname = normalizedHostname(redirected);
      externalTarget = {
        hostname,
        addresses: await resolveSafeAddresses(hostname, options),
      };
    }
    url = redirected;
  }
}

async function resolveSafeAddresses(
  hostname: string,
  options: DownloadOptions,
): Promise<readonly ResolvedAddress[]> {
  let addresses: readonly ResolvedAddress[];
  try {
    addresses = await (options.resolveHostname ?? defaultResolveHostname)(
      hostname,
    );
  } catch {
    throw new CanvasError('NETWORK', 'Canvas file download failed');
  }
  if (
    addresses.length === 0 ||
    addresses.some(
      ({ address, family }) =>
        isIP(address) !== family ||
        (family === 6 && address.toLowerCase().startsWith('::ffff:')) ||
        BLOCKED_ADDRESSES.check(address, family === 4 ? 'ipv4' : 'ipv6'),
    )
  ) {
    throw unsafeRedirectError();
  }
  return addresses.map(({ address, family }) => ({ address, family }));
}

async function defaultResolveHostname(
  hostname: string,
): Promise<readonly ResolvedAddress[]> {
  const answers = await dnsLookup(hostname, { all: true, verbatim: true });
  return answers.flatMap(({ address, family }) =>
    family === 4 || family === 6 ? [{ address, family }] : [],
  );
}

function defaultExternalTransport(
  url: URL,
  options: ExternalRequestOptions,
): Promise<Response> {
  return new Promise<Response>((resolveResponse, rejectResponse) => {
    const request = httpsRequest(
      url,
      {
        method: options.method,
        headers: options.headers,
        signal: options.signal,
        lookup: restrictedLookup(options.addresses),
        servername: normalizedHostname(url),
        agent: false,
      },
      (incoming) => {
        try {
          const headers = new Headers();
          for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
            const name = incoming.rawHeaders[index];
            const value = incoming.rawHeaders[index + 1];
            if (name !== undefined && value !== undefined) {
              headers.append(name, value);
            }
          }
          const status = incoming.statusCode ?? 500;
          const body = responseStatusHasBody(status)
            ? (Readable.toWeb(incoming) as ReadableStream<Uint8Array>)
            : null;
          resolveResponse(
            new Response(body, {
              status,
              ...(incoming.statusMessage
                ? { statusText: incoming.statusMessage }
                : {}),
              headers,
            }),
          );
        } catch (error) {
          incoming.destroy();
          rejectResponse(
            error instanceof Error
              ? error
              : new Error('HTTPS response construction failed'),
          );
        }
      },
    );
    request.once('error', rejectResponse);
    request.end();
  });
}

function restrictedLookup(
  addresses: readonly ResolvedAddress[],
): LookupFunction {
  return (_hostname, options, callback) => {
    const family =
      options.family === 4 || options.family === 6 ? options.family : undefined;
    const eligible =
      family === undefined
        ? addresses
        : addresses.filter((address) => address.family === family);
    const selected = eligible[0];
    if (!selected) {
      const error = Object.assign(new Error('No screened address available'), {
        code: 'ENOTFOUND',
      });
      callback(error, '', 0);
      return;
    }
    if (options.all) {
      callback(
        null,
        eligible.map(({ address, family: addressFamily }) => ({
          address,
          family: addressFamily,
        })),
      );
      return;
    }
    callback(null, selected.address, selected.family);
  };
}

function responseStatusHasBody(status: number): boolean {
  return status !== 204 && status !== 205 && status !== 304;
}

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Redirect response bodies are not data-bearing and cancellation is best effort.
  }
}

function createBlockedAddressList(): BlockList {
  const blocked = new BlockList();
  blocked.addSubnet('0.0.0.0', 8, 'ipv4');
  blocked.addSubnet('10.0.0.0', 8, 'ipv4');
  blocked.addSubnet('100.64.0.0', 10, 'ipv4');
  blocked.addSubnet('127.0.0.0', 8, 'ipv4');
  blocked.addSubnet('169.254.0.0', 16, 'ipv4');
  blocked.addSubnet('172.16.0.0', 12, 'ipv4');
  blocked.addSubnet('192.168.0.0', 16, 'ipv4');
  blocked.addAddress('::', 'ipv6');
  blocked.addAddress('::1', 'ipv6');
  blocked.addSubnet('fc00::', 7, 'ipv6');
  blocked.addSubnet('fe80::', 10, 'ipv6');
  blocked.addSubnet('fec0::', 10, 'ipv6');
  return blocked;
}

function redirectUrl(location: string | null, from: URL): URL {
  try {
    if (!location) throw new Error('Missing location');
    const url = new URL(location, from);
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new Error('Unsafe redirect');
    }
    return url;
  } catch {
    throw unsafeRedirectError();
  }
}

function assertSafeExternalUrl(url: URL): void {
  const hostname = normalizedHostname(url);
  const ipCandidate =
    hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname;
  if (
    !hostname ||
    isIP(ipCandidate) !== 0 ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === 'local' ||
    hostname.endsWith('.local')
  ) {
    throw unsafeRedirectError();
  }
}

function normalizedHostname(url: URL): string {
  return url.hostname.toLowerCase().replace(/\.$/, '');
}

function unsafeRedirectError(): CanvasError {
  return new CanvasError(
    'UNSAFE_URL',
    'Canvas file download returned an unsafe redirect URL',
  );
}

function assertContentLengthWithinLimit(value: string | null): void {
  if (value === null) return;
  if (!/^\d+$/.test(value)) {
    throw new CanvasError(
      'BAD_RESPONSE',
      'Canvas file download returned an invalid Content-Length',
    );
  }
  if (BigInt(value) > BigInt(DOWNLOAD_BYTE_LIMIT)) {
    throw downloadLimitError();
  }
}

function canReadInline(file: CanvasFile, mimeType: string): boolean {
  return (
    typeof file.size === 'number' &&
    Number.isInteger(file.size) &&
    file.size >= 0 &&
    file.size <= INLINE_BYTE_LIMIT &&
    isSupportedTextMimeType(mimeType) &&
    hasUtf8Charset(mimeType)
  );
}

function isSupportedTextMimeType(value: string): boolean {
  const mimeType = baseMimeType(value);
  return (
    mimeType === 'text/plain' ||
    mimeType === 'text/markdown' ||
    mimeType === 'text/x-markdown' ||
    mimeType === 'application/markdown' ||
    mimeType === 'text/csv' ||
    mimeType === 'application/csv' ||
    mimeType === 'application/json' ||
    mimeType.endsWith('+json') ||
    mimeType === 'text/xml' ||
    mimeType === 'application/xml' ||
    mimeType.endsWith('+xml') ||
    isHtmlMimeType(value)
  );
}

function isHtmlMimeType(value: string): boolean {
  const mimeType = baseMimeType(value);
  return mimeType === 'text/html' || mimeType === 'application/xhtml+xml';
}

function baseMimeType(value: string): string {
  return value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function hasUtf8Charset(value: string): boolean {
  const charset = /(?:^|;)\s*charset\s*=\s*["']?([^;"']+)/i.exec(value)?.[1];
  return charset === undefined || /^utf-?8$/i.test(charset.trim());
}

function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

async function readResponseBytes(response: Response): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > DOWNLOAD_BYTE_LIMIT) throw downloadLimitError();
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof CanvasError) throw error;
    throw new CanvasError('NETWORK', 'Canvas file download failed');
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

async function createDownloadDirectory(
  factory: TemporaryDirectoryFactory = (prefix) => mkdtemp(prefix),
  removeDirectory: DirectoryRemover = defaultRemoveDirectory,
): Promise<string> {
  const prefix = join(tmpdir(), TEMP_DIRECTORY_PREFIX);
  const created = resolve(await factory(prefix));
  try {
    await validateDownloadDirectory(created);
  } catch {
    trackDirectory(created, removeDirectory);
    try {
      await removeTrackedDirectory(created);
    } catch {
      // Retain tracking and the exit listener so cleanup can be retried.
    }
    throw temporaryDirectoryError();
  }

  trackDirectory(created, removeDirectory);
  return created;
}

async function validateDownloadDirectory(directory: string): Promise<void> {
  const expectedParent = resolve(tmpdir());
  if (
    dirname(directory) !== expectedParent ||
    !basename(directory).startsWith(TEMP_DIRECTORY_PREFIX)
  ) {
    throw temporaryDirectoryError();
  }

  const info = await lstat(directory);
  const [realCreated, realTemporaryRoot] = await Promise.all([
    realpath(directory),
    realpath(expectedParent),
  ]);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    dirname(realCreated) !== realTemporaryRoot
  ) {
    throw temporaryDirectoryError();
  }
}

function trackDirectory(
  directory: string,
  removeDirectory: DirectoryRemover,
): void {
  if (trackedDirectories.has(directory)) return;
  const installExitListener = trackedDirectories.size === 0;
  trackedDirectories.set(directory, { removeDirectory });
  if (installExitListener) {
    process.once('exit', cleanupTrackedDirectoriesAtExit);
  }
}

async function removeTrackedDirectory(directory: string): Promise<void> {
  const tracked = trackedDirectories.get(directory);
  if (!tracked) return;
  await tracked.removeDirectory(directory);
  trackedDirectories.delete(directory);
  if (trackedDirectories.size === 0) {
    process.removeListener('exit', cleanupTrackedDirectoriesAtExit);
  }
}

function defaultRemoveDirectory(directory: string): Promise<void> {
  return rm(directory, { recursive: true, force: true });
}

function temporaryDirectoryError(): CanvasError {
  return new CanvasError(
    'BAD_RESPONSE',
    'Temporary download directory is outside the system temporary directory',
  );
}

async function writeBytes(path: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
  } finally {
    await handle.close();
  }
}

async function streamResponseToFile(
  response: Response,
  path: string,
): Promise<number> {
  const handle = await open(path, 'wx', 0o600);
  let size = 0;
  try {
    if (!response.body) return size;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > DOWNLOAD_BYTE_LIMIT) throw downloadLimitError();
        await handle.write(value);
      }
    } finally {
      reader.releaseLock();
    }
    return size;
  } finally {
    await handle.close();
  }
}

function safeFilename(file: CanvasFile): string {
  const original = file.filename ?? file.display_name ?? '';
  const sanitized = original.replace(/[^A-Za-z0-9._-]+/g, '_');
  if (
    sanitized === '.' ||
    sanitized === '..' ||
    !/[A-Za-z0-9]/.test(sanitized)
  ) {
    return `canvas-file-${String(file.id)}`;
  }
  return sanitized;
}

function displayName(file: CanvasFile): string {
  return file.display_name ?? file.filename ?? `canvas-file-${String(file.id)}`;
}

function downloadLimitError(): CanvasError {
  return new CanvasError(
    'BAD_RESPONSE',
    'Canvas file exceeds the 25 MiB download limit',
  );
}
