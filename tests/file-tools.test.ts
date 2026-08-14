import {
  access,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasClient } from '../src/canvas/client.js';
import {
  cleanupDownloads,
  downloadCanvasFile,
} from '../src/canvas/download.js';
import type {
  DownloadOptions,
  ExternalRequestOptions,
  ResolvedAddress,
} from '../src/canvas/download.js';
import type { CanvasFile } from '../src/canvas/types.js';
import type { CanvasConfig } from '../src/config.js';
import {
  createFileHandlers,
  type FileToolDependencies,
} from '../src/tools/file-tools.js';
import {
  courseFiles,
  refreshedBinaryFile,
  refreshedHtmlFile,
  refreshedTextFile,
} from './fixtures/files.js';

const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const PUBLIC_ADDRESSES = [
  { address: '93.184.216.34', family: 4 },
] as const satisfies readonly ResolvedAddress[];
const config: Readonly<CanvasConfig> = Object.freeze({
  baseUrl: new URL('https://canvas.example.edu/'),
  apiToken: 'test-only-secret',
  timeoutMs: 15_000,
  maxPages: 20,
});

afterEach(async () => {
  await cleanupDownloads();
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function responseText(result: { content: readonly unknown[] }): string {
  const first = result.content[0];
  if (!first || typeof first !== 'object' || !('text' in first)) return '';
  return String(first.text);
}

function createHandlers(
  apiFetch: typeof fetch,
  downloadFetch: typeof fetch,
  overrides: Partial<FileToolDependencies> = {},
) {
  return createFileHandlers({
    client: new CanvasClient(config, apiFetch),
    timezone: 'Australia/Sydney',
    now: () => new Date('2026-08-14T00:00:00Z'),
    canvasOrigin: config.baseUrl,
    apiToken: config.apiToken,
    downloadFetch,
    createTempDirectory: (prefix) => mkdtemp(prefix),
    ...overrides,
  });
}

function downloadOptions(
  fetchImpl: typeof fetch,
  createTempDirectory = (prefix: string) => mkdtemp(prefix),
  overrides: Partial<DownloadOptions> = {},
): DownloadOptions {
  return {
    canvasOrigin: config.baseUrl,
    apiToken: config.apiToken,
    fetchImpl,
    createTempDirectory,
    ...overrides,
  };
}

function publicResolver(): Promise<readonly ResolvedAddress[]> {
  return Promise.resolve(PUBLIC_ADDRESSES);
}

function binaryFile(overrides: Partial<CanvasFile> = {}): CanvasFile {
  return { ...refreshedBinaryFile, ...overrides };
}

function erroringBody(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('partial file'));
      controller.error(new Error('stream secret'));
    },
  });
}

async function expectMissing(path: string): Promise<void> {
  await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });
}

async function invalidTemporaryPath(kind: string): Promise<{
  readonly created: string;
  readonly cleanup: () => Promise<void>;
}> {
  if (kind === 'unsafe name') {
    const created = await mkdtemp(join(tmpdir(), 'canvas-invalid-'));
    return { created, cleanup: async () => undefined };
  }
  if (kind === 'wrong parent') {
    const parent = await mkdtemp(join(tmpdir(), 'canvas-parent-'));
    const created = await mkdtemp(join(parent, 'mcp-server-canvas-lms-'));
    return {
      created,
      cleanup: () => rm(parent, { recursive: true, force: true }),
    };
  }
  if (kind === 'non-directory') {
    const created = join(tmpdir(), `mcp-server-canvas-lms-${randomUUID()}`);
    await writeFile(created, 'not a directory');
    return { created, cleanup: async () => undefined };
  }

  const target = await mkdtemp(join(tmpdir(), 'canvas-symlink-target-'));
  const created = join(tmpdir(), `mcp-server-canvas-lms-${randomUUID()}`);
  await symlink(target, created, 'dir');
  return {
    created,
    cleanup: () => rm(target, { recursive: true, force: true }),
  };
}

describe('file handlers', () => {
  it('lists course files with the fixed search, sort, order, and page size', async () => {
    const apiFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(courseFiles));
    const downloadFetch = vi.fn<typeof fetch>();

    const text = responseText(
      await createHandlers(apiFetch, downloadFetch).listFiles({
        course_id: 101,
        search: 'week one & maps',
      }),
    );

    expect(apiFetch).toHaveBeenCalledWith(
      'https://canvas.example.edu/api/v1/courses/101/files?search_term=week+one+%26+maps&sort=name&order=asc&per_page=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(text).toContain('Canvas files');
    expect(text).toContain('Week 1 notes.md');
    expect(text).toContain('File ID: 801');
    expect(text).toContain('text/markdown; charset=utf-8');
    expect(text).toContain(
      'Canvas: https://canvas.example.edu/courses/101/files/801/preview',
    );
    expect(downloadFetch).not.toHaveBeenCalled();
  });

  it('omits search_term when no file search is supplied', async () => {
    const apiFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([]));

    const text = responseText(
      await createHandlers(apiFetch, vi.fn<typeof fetch>()).listFiles({
        course_id: 101,
      }),
    );

    expect(apiFetch).toHaveBeenCalledWith(
      'https://canvas.example.edu/api/v1/courses/101/files?sort=name&order=asc&per_page=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(text).toBe('No Canvas files found for this course.');
  });

  it('rejects a file absent from the paginated course membership list before global metadata or download', async () => {
    const apiFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(courseFiles));
    const downloadFetch = vi.fn<typeof fetch>();

    await expect(
      createHandlers(apiFetch, downloadFetch).readFile({
        course_id: 101,
        file_id: 999,
      }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Canvas file was not found in this course',
    });

    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith(
      'https://canvas.example.edu/api/v1/courses/101/files?per_page=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(downloadFetch).not.toHaveBeenCalled();
  });

  it('refreshes metadata only after course membership and returns small UTF-8 text unchanged', async () => {
    const body = '# Current notes\nBring a compass.';
    const current = { ...refreshedTextFile, size: Buffer.byteLength(body) };
    const apiFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(courseFiles))
      .mockResolvedValueOnce(jsonResponse(current));
    const downloadFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(body));

    const text = responseText(
      await createHandlers(apiFetch, downloadFetch).readFile({
        course_id: 101,
        file_id: 801,
      }),
    );

    expect(apiFetch).toHaveBeenNthCalledWith(
      1,
      'https://canvas.example.edu/api/v1/courses/101/files?per_page=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(apiFetch).toHaveBeenNthCalledWith(
      2,
      'https://canvas.example.edu/api/v1/files/801',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(text).toContain('File: Current week 1 notes.md');
    expect(text).toContain(body);
    expect(downloadFetch).toHaveBeenCalledWith(
      'https://canvas.example.edu/files/801/download?download_frd=1',
      expect.objectContaining({
        method: 'GET',
        redirect: 'manual',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-only-secret',
        }),
      }),
    );
  });

  it('forwards injected DNS and transport controls for handler-triggered external downloads', async () => {
    const apiFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(courseFiles))
      .mockResolvedValueOnce(jsonResponse(refreshedBinaryFile));
    const downloadFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: 'https://downloads.example.net/file' },
      }),
    );
    const resolveHostname = vi.fn().mockResolvedValue(PUBLIC_ADDRESSES);
    const externalTransport = vi
      .fn<(url: URL, options: ExternalRequestOptions) => Promise<Response>>()
      .mockResolvedValue(new Response(new Uint8Array([1, 2])));

    const text = responseText(
      await createHandlers(apiFetch, downloadFetch, {
        resolveHostname,
        externalTransport,
      }).readFile({ course_id: 101, file_id: 803 }),
    );

    expect(text).toContain('Canvas file downloaded');
    expect(resolveHostname).toHaveBeenCalledWith('downloads.example.net');
    expect(externalTransport).toHaveBeenCalledTimes(1);
  });

  it('cleans inline HTML and caps non-HTML inline text at 100,000 characters', async () => {
    const html =
      '<h2>Guide</h2><p>Use the <a href="https://canvas.example.edu/map">map</a>.</p><script>steal()</script>';
    const htmlFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(html));

    const htmlResult = await downloadCanvasFile(
      { ...refreshedHtmlFile, size: Buffer.byteLength(html) },
      downloadOptions(htmlFetch),
    );

    expect(htmlResult).toMatchObject({
      kind: 'inline',
      name: 'Field guide.html',
      mimeType: 'text/html; charset=UTF-8',
      text: 'GUIDE Use the map [https://canvas.example.edu/map].',
    });

    const longText = 'x'.repeat(100_001);
    const textFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(longText));
    const textResult = await downloadCanvasFile(
      {
        ...refreshedTextFile,
        size: Buffer.byteLength(longText),
      },
      downloadOptions(textFetch),
    );

    expect(textResult.kind).toBe('inline');
    if (textResult.kind !== 'inline') throw new Error('Expected inline file');
    expect(textResult.text).toBe('x'.repeat(100_000));
  });

  it.each([
    'text/plain',
    'text/markdown',
    'application/json',
    'text/csv',
    'text/xml',
    'application/xml',
  ])('returns a small UTF-8 %s file inline', async (contentType) => {
    const body = 'kept exactly\n';
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(body));

    const result = await downloadCanvasFile(
      {
        ...refreshedTextFile,
        content_type: `${contentType}; charset=utf-8`,
        size: Buffer.byteLength(body),
      },
      downloadOptions(fetchImpl),
    );

    expect(result).toMatchObject({ kind: 'inline', text: body });
  });

  it('downloads supported text above 256 KiB and bytes that are not valid UTF-8', async () => {
    const oversizedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('small body'));
    const oversized = await downloadCanvasFile(
      { ...refreshedTextFile, size: 256 * 1024 + 1 },
      downloadOptions(oversizedFetch),
    );
    expect(oversized).toMatchObject({ kind: 'downloaded', size: 10 });

    const invalidBytes = new Uint8Array([0xc3, 0x28]);
    const invalidUtf8Fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(invalidBytes));
    const invalidUtf8 = await downloadCanvasFile(
      { ...refreshedTextFile, size: invalidBytes.byteLength },
      downloadOptions(invalidUtf8Fetch),
    );
    expect(invalidUtf8).toMatchObject({
      kind: 'downloaded',
      size: invalidBytes.byteLength,
    });
  });

  it('downloads binary files into a prefixed os.tmpdir directory with a sanitized name', async () => {
    const body = new Uint8Array([1, 2, 3, 4]);
    const tempFactory = vi.fn((prefix: string) => mkdtemp(prefix));
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(body, { headers: { 'Content-Length': '4' } }),
      );

    const result = await downloadCanvasFile(
      binaryFile({ size: body.byteLength }),
      downloadOptions(fetchImpl, tempFactory),
    );

    expect(result.kind).toBe('downloaded');
    if (result.kind !== 'downloaded') throw new Error('Expected download');
    expect(tempFactory).toHaveBeenCalledTimes(1);
    expect(tempFactory.mock.calls[0]?.[0]).toBe(
      join(tmpdir(), 'mcp-server-canvas-lms-'),
    );
    expect(dirname(dirname(result.path))).toBe(resolve(tmpdir()));
    expect(basename(dirname(result.path))).toMatch(/^mcp-server-canvas-lms-/);
    expect(result.name).toBe('dragon_map_.pdf');
    expect(basename(result.path)).toBe(result.name);
    expect(result.size).toBe(4);
    await expect(readFile(result.path)).resolves.toEqual(Buffer.from(body));
  });

  it('uses a safe fallback when the Canvas filename has no usable ASCII characters', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(new Uint8Array([7])));

    const result = await downloadCanvasFile(
      binaryFile({ display_name: '🗺️', filename: '🗺️', size: 1 }),
      downloadOptions(fetchImpl),
    );

    expect(result).toMatchObject({
      kind: 'downloaded',
      name: 'canvas-file-803',
      size: 1,
    });
  });

  it.each([
    ['non-HTTPS URL', 'http://canvas.example.edu/files/803/download'],
    ['different initial origin', 'https://evil.example/files/803/download'],
    [
      'URL credentials',
      'https://user:password@canvas.example.edu/files/803/download',
    ],
  ])('rejects an unsafe initial %s without fetching', async (_case, url) => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      downloadCanvasFile(binaryFile({ url }), downloadOptions(fetchImpl)),
    ).rejects.toMatchObject({ code: 'UNSAFE_URL' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('allows one Canvas-to-external transition and strips authorization from every external request', async () => {
    const canvasFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { Location: 'https://downloads.example.net/tokenized/a' },
      }),
    );
    const externalTransport = vi
      .fn<(url: URL, options: ExternalRequestOptions) => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: { Location: '/tokenized/b' },
        }),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2])));

    await expect(
      downloadCanvasFile(
        binaryFile(),
        downloadOptions(canvasFetch, undefined, {
          resolveHostname: publicResolver,
          externalTransport,
        }),
      ),
    ).resolves.toMatchObject({ kind: 'downloaded', size: 2 });

    expect(
      new Headers(canvasFetch.mock.calls[0]?.[1]?.headers).get('authorization'),
    ).toBe('Bearer test-only-secret');
    expect(String(externalTransport.mock.calls[0]?.[0])).toBe(
      'https://downloads.example.net/tokenized/a',
    );
    expect(
      new Headers(externalTransport.mock.calls[0]?.[1].headers).has(
        'authorization',
      ),
    ).toBe(false);
    expect(String(externalTransport.mock.calls[1]?.[0])).toBe(
      'https://downloads.example.net/tokenized/b',
    );
    expect(
      new Headers(externalTransport.mock.calls[1]?.[1].headers).has(
        'authorization',
      ),
    ).toBe(false);
    expect(canvasFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['localhost', 'https://localhost/file'],
    ['localhost subdomain', 'https://api.localhost/file'],
    ['local hostname', 'https://storage.canvas.local/file'],
    ['IPv4 literal', 'https://10.0.0.8/file'],
    ['IPv6 literal', 'https://[::1]/file'],
    ['link-local literal', 'https://169.254.10.2/file'],
  ])('rejects a redirect to %s', async (_case, location) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: location },
      }),
    );

    await expect(
      downloadCanvasFile(binaryFile(), downloadOptions(fetchImpl)),
    ).rejects.toMatchObject({ code: 'UNSAFE_URL' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects a hostname change after leaving Canvas', async () => {
    const canvasFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { Location: 'https://downloads.example.net/a' },
      }),
    );
    const externalTransport = vi
      .fn<(url: URL, options: ExternalRequestOptions) => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: 'https://cdn.example.net/b' },
        }),
      );

    await expect(
      downloadCanvasFile(
        binaryFile(),
        downloadOptions(canvasFetch, undefined, {
          resolveHostname: publicResolver,
          externalTransport,
        }),
      ),
    ).rejects.toMatchObject({ code: 'UNSAFE_URL' });
    expect(canvasFetch).toHaveBeenCalledTimes(1);
    expect(externalTransport).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['IPv4 private', [{ address: '10.23.4.5', family: 4 }]],
    ['IPv4 link-local', [{ address: '169.254.20.1', family: 4 }]],
    ['IPv6 loopback', [{ address: '::1', family: 6 }]],
    ['IPv6 private', [{ address: 'fd12:3456::1', family: 6 }]],
    ['IPv6 link-local', [{ address: 'fe80::1234', family: 6 }]],
    [
      'mixed public and private',
      [
        { address: '93.184.216.34', family: 4 },
        { address: '192.168.1.40', family: 4 },
      ],
    ],
  ] satisfies readonly [string, readonly ResolvedAddress[]][])(
    'rejects an external hostname resolving to %s addresses before an external request',
    async (_case, answers) => {
      const canvasFetch = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { Location: 'https://public-looking.example/file' },
        }),
      );
      const resolveHostname = vi.fn().mockResolvedValue(answers);
      const externalTransport =
        vi.fn<
          (url: URL, options: ExternalRequestOptions) => Promise<Response>
        >();

      await expect(
        downloadCanvasFile(
          binaryFile(),
          downloadOptions(canvasFetch, undefined, {
            resolveHostname,
            externalTransport,
          }),
        ),
      ).rejects.toMatchObject({ code: 'UNSAFE_URL' });

      expect(resolveHostname).toHaveBeenCalledWith('public-looking.example');
      expect(externalTransport).not.toHaveBeenCalled();
      expect(canvasFetch).toHaveBeenCalledTimes(1);
    },
  );

  it('allows an external hostname only after all resolved addresses are public', async () => {
    const canvasFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: 'https://downloads.example.net/file' },
      }),
    );
    const resolveHostname = vi.fn().mockResolvedValue(PUBLIC_ADDRESSES);
    const externalTransport = vi
      .fn<(url: URL, options: ExternalRequestOptions) => Promise<Response>>()
      .mockResolvedValue(new Response(new Uint8Array([9])));

    await expect(
      downloadCanvasFile(
        binaryFile(),
        downloadOptions(canvasFetch, undefined, {
          resolveHostname,
          externalTransport,
        }),
      ),
    ).resolves.toMatchObject({ kind: 'downloaded', size: 1 });

    expect(externalTransport).toHaveBeenCalledTimes(1);
    expect(externalTransport.mock.calls[0]?.[1].addresses).toEqual(
      PUBLIC_ADDRESSES,
    );
  });

  it('reuses the screened address set for same-host redirects instead of resolving again', async () => {
    const canvasFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: 'https://downloads.example.net/first' },
      }),
    );
    const resolveHostname = vi
      .fn()
      .mockResolvedValueOnce(PUBLIC_ADDRESSES)
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    const externalTransport = vi
      .fn<(url: URL, options: ExternalRequestOptions) => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: '/second' },
        }),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([8])));

    await expect(
      downloadCanvasFile(
        binaryFile(),
        downloadOptions(canvasFetch, undefined, {
          resolveHostname,
          externalTransport,
        }),
      ),
    ).resolves.toMatchObject({ kind: 'downloaded', size: 1 });

    expect(resolveHostname).toHaveBeenCalledTimes(1);
    expect(externalTransport).toHaveBeenCalledTimes(2);
    expect(
      externalTransport.mock.calls.map((call) => call[1].addresses),
    ).toEqual([PUBLIC_ADDRESSES, PUBLIC_ADDRESSES]);
  });

  it('follows no more than three manual redirects', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: '/next' },
      }),
    );

    await expect(
      downloadCanvasFile(binaryFile(), downloadOptions(fetchImpl)),
    ).rejects.toMatchObject({
      code: 'UNSAFE_URL',
      message: 'Canvas file download returned too many redirects',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('rejects Content-Length above 25 MiB before creating a directory', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        headers: { 'Content-Length': String(MAX_DOWNLOAD_BYTES + 1) },
      }),
    );
    const tempFactory = vi.fn((prefix: string) => mkdtemp(prefix));

    await expect(
      downloadCanvasFile(
        binaryFile({ size: MAX_DOWNLOAD_BYTES + 1 }),
        downloadOptions(fetchImpl, tempFactory),
      ),
    ).rejects.toMatchObject({
      code: 'BAD_RESPONSE',
      message: 'Canvas file exceeds the 25 MiB download limit',
    });
    expect(tempFactory).not.toHaveBeenCalled();
  });

  it('enforces the streamed 25 MiB limit and removes the partial directory', async () => {
    const chunks = [
      new Uint8Array(13 * 1024 * 1024),
      new Uint8Array(12 * 1024 * 1024 + 1),
    ];
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(new Blob(chunks)));
    let createdDirectory = '';
    const tempFactory = async (prefix: string) => {
      createdDirectory = await mkdtemp(prefix);
      return createdDirectory;
    };

    await expect(
      downloadCanvasFile(binaryFile(), downloadOptions(fetchImpl, tempFactory)),
    ).rejects.toMatchObject({
      code: 'BAD_RESPONSE',
      message: 'Canvas file exceeds the 25 MiB download limit',
    });
    expect(createdDirectory).not.toBe('');
    await expectMissing(createdDirectory);
  });

  it('removes a partial file and directory when the response stream fails', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(erroringBody()));
    let createdDirectory = '';
    const tempFactory = async (prefix: string) => {
      createdDirectory = await mkdtemp(prefix);
      return createdDirectory;
    };

    await expect(
      downloadCanvasFile(binaryFile(), downloadOptions(fetchImpl, tempFactory)),
    ).rejects.toMatchObject({
      code: 'NETWORK',
      message: 'Canvas file download failed',
    });
    expect(createdDirectory).not.toBe('');
    await expectMissing(createdDirectory);
  });

  it('preserves the original download error and retries failed partial cleanup later', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(erroringBody()));
    let createdDirectory = '';
    const removeDirectory = vi
      .fn<(path: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('cleanup path secret'))
      .mockImplementation((path) => rm(path, { recursive: true, force: true }));

    await expect(
      downloadCanvasFile(
        binaryFile(),
        downloadOptions(
          fetchImpl,
          async (prefix) => {
            createdDirectory = await mkdtemp(prefix);
            return createdDirectory;
          },
          { removeDirectory },
        ),
      ),
    ).rejects.toMatchObject({
      code: 'NETWORK',
      message: 'Canvas file download failed',
    });

    await expect(stat(createdDirectory)).resolves.toBeDefined();
    await expect(cleanupDownloads()).resolves.toBeUndefined();
    expect(removeDirectory).toHaveBeenCalledTimes(2);
    await expectMissing(createdDirectory);
  });

  it('keeps successful downloads tracked until deletion succeeds', async () => {
    const initialExitListeners = process.listenerCount('exit');
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(new Uint8Array([1])));
    const removeDirectory = vi
      .fn<(path: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('cleanup path secret'))
      .mockImplementation((path) => rm(path, { recursive: true, force: true }));
    const result = await downloadCanvasFile(
      binaryFile(),
      downloadOptions(fetchImpl, undefined, { removeDirectory }),
    );
    if (result.kind !== 'downloaded') throw new Error('Expected download');
    expect(process.listenerCount('exit')).toBe(initialExitListeners + 1);

    await expect(cleanupDownloads()).rejects.toMatchObject({
      code: 'BAD_RESPONSE',
      message: 'Unable to clean up temporary Canvas downloads',
    });
    await expect(stat(result.path)).resolves.toBeDefined();
    expect(process.listenerCount('exit')).toBe(initialExitListeners + 1);

    await expect(cleanupDownloads()).resolves.toBeUndefined();
    expect(removeDirectory).toHaveBeenCalledTimes(2);
    await expectMissing(dirname(result.path));
    expect(process.listenerCount('exit')).toBe(initialExitListeners);
  });

  it('uses one exit listener while more than ten downloads are tracked', async () => {
    const initialExitListeners = process.listenerCount('exit');
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(new Uint8Array([1])));

    for (let index = 0; index < 12; index += 1) {
      const result = await downloadCanvasFile(
        binaryFile({ id: index + 1 }),
        downloadOptions(fetchImpl),
      );
      if (result.kind !== 'downloaded') throw new Error('Expected download');
    }

    expect(process.listenerCount('exit')).toBe(initialExitListeners + 1);

    await cleanupDownloads();

    expect(process.listenerCount('exit')).toBe(initialExitListeners);
  });

  it.each(['unsafe name', 'wrong parent', 'non-directory', 'symlink'])(
    'removes a factory-created %s after temporary-directory validation fails',
    async (kind) => {
      const invalid = await invalidTemporaryPath(kind);
      try {
        const fetchImpl = vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response(new Uint8Array([1])));

        await expect(
          downloadCanvasFile(
            binaryFile(),
            downloadOptions(fetchImpl, async () => invalid.created),
          ),
        ).rejects.toMatchObject({
          code: 'BAD_RESPONSE',
          message:
            'Temporary download directory is outside the system temporary directory',
        });

        await expectMissing(invalid.created);
      } finally {
        await invalid.cleanup();
      }
    },
  );

  it('tracks a validation-failed directory when immediate removal fails so cleanup can retry', async () => {
    const created = await mkdtemp(join(tmpdir(), 'canvas-invalid-'));
    const removeDirectory = vi
      .fn<(path: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('cleanup path secret'))
      .mockImplementation((path) => rm(path, { recursive: true, force: true }));
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(new Uint8Array([1])));

    await expect(
      downloadCanvasFile(
        binaryFile(),
        downloadOptions(fetchImpl, async () => created, { removeDirectory }),
      ),
    ).rejects.toMatchObject({
      code: 'BAD_RESPONSE',
      message:
        'Temporary download directory is outside the system temporary directory',
    });
    await expect(stat(created)).resolves.toBeDefined();

    await expect(cleanupDownloads()).resolves.toBeUndefined();
    expect(removeDirectory).toHaveBeenCalledTimes(2);
    await expectMissing(created);
  });

  it('cleanupDownloads removes successful temporary downloads', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(new Uint8Array([1])));
    const result = await downloadCanvasFile(
      binaryFile(),
      downloadOptions(fetchImpl),
    );
    if (result.kind !== 'downloaded') throw new Error('Expected download');
    await expect(stat(result.path)).resolves.toBeDefined();

    await cleanupDownloads();

    await expectMissing(dirname(result.path));
    await expect(cleanupDownloads()).resolves.toBeUndefined();
  });

  it.each([
    [{ course_id: 0 }, 'course_id must be a positive integer'],
    [{ course_id: 101, file_id: 1.5 }, 'file_id must be a positive integer'],
  ])('rejects invalid IDs before making requests', async (input, message) => {
    const apiFetch = vi.fn<typeof fetch>();
    const handlers = createHandlers(apiFetch, vi.fn<typeof fetch>());

    const action =
      'file_id' in input
        ? handlers.readFile(input)
        : handlers.listFiles(input as { course_id: number });
    await expect(action).rejects.toThrow(message);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
