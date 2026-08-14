import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { CanvasClient } from '../src/canvas/client.js';
import { CanvasError } from '../src/canvas/errors.js';
import type { CanvasConfig } from '../src/config.js';

const config: Readonly<CanvasConfig> = Object.freeze({
  baseUrl: new URL('https://canvas.example.edu/'),
  apiToken: 'secret-value',
  timeoutMs: 15_000,
  maxPages: 20,
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

async function captureError(
  action: () => Promise<unknown>,
): Promise<CanvasError> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(CanvasError);
    return error as CanvasError;
  }
  throw new Error('Expected action to reject');
}

describe('CanvasClient', () => {
  it('sends authenticated API requests using GET only', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ id: 1 }));
    const client = new CanvasClient(config, fetchMock);

    await expect(
      client.get<{ id: number }>('/courses', {
        enrollment_state: 'active',
      }),
    ).resolves.toEqual({ id: 1 });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://canvas.example.edu/api/v1/courses?enrollment_state=active',
      expect.objectContaining({
        method: 'GET',
        redirect: 'manual',
        headers: expect.objectContaining({
          Accept: 'application/json',
          Authorization: 'Bearer secret-value',
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('follows a same-origin next link and combines both pages', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse([{ id: 1 }], {
          headers: {
            Link: '<https://canvas.example.edu/api/v1/courses?page=2>; rel="next"',
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse([{ id: 2 }]));
    const client = new CanvasClient(config, fetchMock);

    await expect(client.getAll<{ id: number }>('/courses')).resolves.toEqual([
      { id: 1 },
      { id: 2 },
    ]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://canvas.example.edu/api/v1/courses?page=2',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('rejects a cross-origin pagination link', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse([], {
        headers: {
          Link: '<https://evil.example/api/v1/courses?page=2>; rel="next"',
        },
      }),
    );
    const client = new CanvasClient(config, fetchMock);

    const error = await captureError(() => client.getAll('/courses'));

    expect(error.code).toBe('UNSAFE_URL');
    expect(error.message).toBe('Canvas returned an unsafe pagination URL');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects pagination beyond the configured page limit', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
      jsonResponse([], {
        headers: {
          Link: '<https://canvas.example.edu/api/v1/courses?page=21>; rel="next"',
        },
      }),
    );
    const client = new CanvasClient(config, fetchMock);

    const error = await captureError(() => client.getAll('/courses'));

    expect(error.code).toBe('BAD_RESPONSE');
    expect(error.message).toBe('Canvas pagination exceeded 20 pages');
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });

  it.each([
    [401, 'UNAUTHORIZED', 'Canvas authentication failed'],
    [403, 'FORBIDDEN', 'Canvas denied access to this resource'],
    [404, 'NOT_FOUND', 'Canvas resource was not found'],
    [429, 'RATE_LIMITED', 'Canvas rate limit reached; please try again later'],
  ] as const)(
    'maps status %i to a safe Canvas error',
    async (status, code, message) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('secret-value', { status }));
      const client = new CanvasClient(config, fetchMock);

      const error = await captureError(() => client.get('/courses'));

      expect(error.code).toBe(code);
      expect(error.message).toBe(message);
      expect(String(error)).not.toContain('secret-value');
      expect(fetchMock).toHaveBeenCalledTimes(status === 429 ? 3 : 1);
    },
  );

  it('retries a rate-limited request after a numeric Retry-After delay', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(null, {
            status: 429,
            headers: { 'Retry-After': '1' },
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ id: 1 }));
      const client = new CanvasClient(config, fetchMock);

      const result = client.get<{ id: number }>('/courses/1');
      await vi.advanceTimersByTimeAsync(999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);

      await expect(result).resolves.toEqual({ id: 1 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('follows a same-origin HTTPS redirect manually', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: '/api/v1/courses/2' },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: 2 }));
    const client = new CanvasClient(config, fetchMock);

    await expect(client.get<{ id: number }>('/courses/1')).resolves.toEqual({
      id: 2,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://canvas.example.edu/api/v1/courses/2',
      expect.objectContaining({ method: 'GET', redirect: 'manual' }),
    );
  });

  it('rejects a redirect to an untrusted origin', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: 'https://evil.example/steal-token' },
      }),
    );
    const client = new CanvasClient(config, fetchMock);

    const error = await captureError(() => client.get('/courses'));

    expect(error.code).toBe('UNSAFE_URL');
    expect(error.message).toBe('Canvas returned an unsafe redirect URL');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps an aborted request to a safe timeout error', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('secret-value', 'AbortError'));
    const client = new CanvasClient(config, fetchMock);

    const error = await captureError(() => client.get('/courses'));

    expect(error.code).toBe('TIMEOUT');
    expect(error.message).toBe(
      'Canvas request to canvas.example.edu timed out',
    );
    expect(String(error)).not.toContain('secret-value');
  });

  it('does not expose response or network details in errors', async () => {
    const responseFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('secret-value', { status: 500 }));
    const networkFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('secret-value'));

    const responseError = await captureError(() =>
      new CanvasClient(config, responseFetch).get('/courses'),
    );
    const networkError = await captureError(() =>
      new CanvasClient(config, networkFetch).get('/courses'),
    );

    expect(responseError.code).toBe('BAD_RESPONSE');
    expect(responseError.message).toBe(
      'Canvas returned status 500 from canvas.example.edu',
    );
    expect(networkError.code).toBe('NETWORK');
    expect(networkError.message).toBe(
      'Unable to reach Canvas at canvas.example.edu',
    );
    expect(`${responseError} ${networkError}`).not.toContain('secret-value');
  });

  it('keeps the source boundary structurally GET-only', async () => {
    const source = await readFile(
      new URL('../src/canvas/client.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain("method: 'GET'");
    expect(source).not.toMatch(
      /^\s*(?:public\s+)?(?:async\s+)?request\s*[<(]/m,
    );
    expect(source).not.toMatch(/['"](?:POST|PUT|PATCH|DELETE)['"]/);
  });
});
