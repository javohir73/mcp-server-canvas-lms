import { lstat, mkdtemp, open, realpath, rm } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
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

export interface DownloadOptions {
  readonly canvasOrigin: URL;
  readonly apiToken: string;
  readonly fetchImpl?: typeof fetch;
  readonly createTempDirectory?: TemporaryDirectoryFactory;
  readonly timeoutMs?: number;
}

const INLINE_BYTE_LIMIT = 256 * 1024;
const INLINE_CHARACTER_LIMIT = 100_000;
const DOWNLOAD_BYTE_LIMIT = 25 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 15_000;
const TEMP_DIRECTORY_PREFIX = 'mcp-server-canvas-lms-';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

interface TrackedDirectory {
  readonly cleanupAtExit: () => void;
}

const trackedDirectories = new Map<string, TrackedDirectory>();

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

      directory = await createDownloadDirectory(options.createTempDirectory);
      const name = safeFilename(file);
      const path = join(directory, name);
      await writeBytes(path, bytes);
      return { kind: 'downloaded', name, mimeType, path, size: bytes.length };
    }

    directory = await createDownloadDirectory(options.createTempDirectory);
    const name = safeFilename(file);
    const path = join(directory, name);
    const size = await streamResponseToFile(response, path);
    return { kind: 'downloaded', name, mimeType, path, size };
  } catch (error) {
    if (directory) await removeTrackedDirectory(directory);
    if (error instanceof CanvasError) throw error;
    throw new CanvasError('NETWORK', 'Canvas file download failed');
  }
}

export async function cleanupDownloads(): Promise<void> {
  const directories = [...trackedDirectories.entries()];
  trackedDirectories.clear();
  for (const [, tracked] of directories) {
    process.removeListener('exit', tracked.cleanupAtExit);
  }
  await Promise.all(
    directories.map(([directory]) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
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
  let externalHostname: string | undefined;
  let redirectCount = 0;

  for (;;) {
    let response: Response;
    try {
      const headers: Record<string, string> = { Accept: '*/*' };
      if (url.origin === options.canvasOrigin.origin) {
        headers.Authorization = `Bearer ${options.apiToken}`;
      }
      response = await fetchImpl(url.href, {
        method: 'GET',
        redirect: 'manual',
        headers,
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
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

    if (externalHostname !== undefined) {
      if (normalizedHostname(redirected) !== externalHostname) {
        throw unsafeRedirectError();
      }
      assertSafeExternalUrl(redirected);
    } else if (redirected.origin !== options.canvasOrigin.origin) {
      assertSafeExternalUrl(redirected);
      externalHostname = normalizedHostname(redirected);
    }
    url = redirected;
  }
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
): Promise<string> {
  const prefix = join(tmpdir(), TEMP_DIRECTORY_PREFIX);
  const created = resolve(await factory(prefix));
  const expectedParent = resolve(tmpdir());
  if (
    dirname(created) !== expectedParent ||
    !basename(created).startsWith(TEMP_DIRECTORY_PREFIX)
  ) {
    throw new CanvasError(
      'BAD_RESPONSE',
      'Temporary download directory is outside the system temporary directory',
    );
  }

  const info = await lstat(created);
  const [realCreated, realTemporaryRoot] = await Promise.all([
    realpath(created),
    realpath(expectedParent),
  ]);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    dirname(realCreated) !== realTemporaryRoot
  ) {
    throw new CanvasError(
      'BAD_RESPONSE',
      'Temporary download directory is outside the system temporary directory',
    );
  }

  trackDirectory(created);
  return created;
}

function trackDirectory(directory: string): void {
  const cleanupAtExit = () => {
    try {
      rmSync(directory, { recursive: true, force: true });
    } finally {
      trackedDirectories.delete(directory);
    }
  };
  trackedDirectories.set(directory, { cleanupAtExit });
  process.once('exit', cleanupAtExit);
}

async function removeTrackedDirectory(directory: string): Promise<void> {
  const tracked = trackedDirectories.get(directory);
  if (tracked) process.removeListener('exit', tracked.cleanupAtExit);
  trackedDirectories.delete(directory);
  await rm(directory, { recursive: true, force: true });
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
