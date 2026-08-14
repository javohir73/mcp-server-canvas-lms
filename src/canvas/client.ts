import type { CanvasConfig } from '../config.js';
import { CanvasError } from './errors.js';

export type CanvasPath = `/${string}`;
export type CanvasQuery = Readonly<
  Record<string, string | number | boolean | readonly string[] | undefined>
>;

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_RETRIES = 2;
const MAX_REDIRECTS = 5;
const MAX_RETRY_DELAY_MS = 5_000;

export class CanvasClient {
  constructor(
    private readonly config: Readonly<CanvasConfig>,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  async get<T>(path: CanvasPath, query: CanvasQuery = {}): Promise<T> {
    const url = this.buildApiUrl(path, query);
    return this.fetchJson<T>(url);
  }

  async getAll<T>(path: CanvasPath, query: CanvasQuery = {}): Promise<T[]> {
    const values: T[] = [];
    let next: URL | undefined = this.buildApiUrl(path, query);
    for (let page = 1; next && page <= this.config.maxPages; page += 1) {
      const response = await this.fetchResponse(next);
      const body = await this.readJson(response);
      if (!Array.isArray(body)) {
        throw new CanvasError(
          'BAD_RESPONSE',
          'Canvas returned an invalid list response',
        );
      }
      values.push(...(body as T[]));
      next = this.readSafeNextLink(response.headers.get('link'));
    }
    if (next) {
      throw new CanvasError(
        'BAD_RESPONSE',
        `Canvas pagination exceeded ${String(this.config.maxPages)} pages`,
      );
    }
    return values;
  }

  private buildApiUrl(path: CanvasPath, query: CanvasQuery): URL {
    if (path.includes('?') || path.includes('#')) {
      throw new CanvasError('UNSAFE_URL', 'Canvas API path is unsafe');
    }
    const url = new URL(`/api/v1${path}`, this.config.baseUrl);
    if (url.pathname !== '/api/v1' && !url.pathname.startsWith('/api/v1/')) {
      throw new CanvasError('UNSAFE_URL', 'Canvas API path is unsafe');
    }
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value as readonly string[]) {
          url.searchParams.append(key, item);
        }
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    return url;
  }

  private async fetchJson<T>(url: URL): Promise<T> {
    const response = await this.fetchResponse(url);
    return (await this.readJson(response)) as T;
  }

  private async fetchResponse(initialUrl: URL): Promise<Response> {
    let url = initialUrl;
    let retries = 0;
    let redirects = 0;

    for (;;) {
      let response: Response;
      try {
        response = await this.fetchImpl(url.href, {
          method: 'GET',
          redirect: 'manual',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${this.config.apiToken}`,
          },
          signal: AbortSignal.timeout(this.config.timeoutMs),
        });
      } catch (error) {
        if (this.isAbortError(error)) {
          throw new CanvasError(
            'TIMEOUT',
            `Canvas request to ${this.config.baseUrl.hostname} timed out`,
          );
        }
        throw new CanvasError(
          'NETWORK',
          `Unable to reach Canvas at ${this.config.baseUrl.hostname}`,
        );
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        redirects += 1;
        if (redirects > MAX_REDIRECTS) {
          throw new CanvasError(
            'BAD_RESPONSE',
            'Canvas returned too many redirects',
          );
        }
        url = this.readSafeRedirect(response.headers.get('location'), url);
        continue;
      }

      if (RETRYABLE_STATUSES.has(response.status) && retries < MAX_RETRIES) {
        retries += 1;
        await this.waitForRetry(response.headers.get('retry-after'));
        continue;
      }

      if (!response.ok) throw this.errorForStatus(response.status);
      return response;
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new CanvasError(
        'BAD_RESPONSE',
        'Canvas returned an invalid JSON response',
      );
    }
  }

  private readSafeNextLink(linkHeader: string | null): URL | undefined {
    if (!linkHeader) return undefined;
    const next = /<([^>]*)>\s*;[^,]*\brel\s*=\s*["']?next["']?/i.exec(
      linkHeader,
    )?.[1];
    if (!next) return undefined;

    let url: URL;
    try {
      url = new URL(next, this.config.baseUrl);
    } catch {
      throw new CanvasError(
        'UNSAFE_URL',
        'Canvas returned an unsafe pagination URL',
      );
    }
    if (!this.hasConfiguredOrigin(url) || url.username || url.password) {
      throw new CanvasError(
        'UNSAFE_URL',
        'Canvas returned an unsafe pagination URL',
      );
    }
    return url;
  }

  private readSafeRedirect(location: string | null, from: URL): URL {
    let url: URL;
    try {
      if (!location) throw new Error('Missing redirect location');
      url = new URL(location, from);
    } catch {
      throw new CanvasError(
        'UNSAFE_URL',
        'Canvas returned an unsafe redirect URL',
      );
    }
    if (
      url.protocol !== 'https:' ||
      !this.hasConfiguredOrigin(url) ||
      url.username ||
      url.password
    ) {
      throw new CanvasError(
        'UNSAFE_URL',
        'Canvas returned an unsafe redirect URL',
      );
    }
    return url;
  }

  private hasConfiguredOrigin(url: URL): boolean {
    return url.origin === this.config.baseUrl.origin;
  }

  private errorForStatus(status: number): CanvasError {
    switch (status) {
      case 401:
        return new CanvasError('UNAUTHORIZED', 'Canvas authentication failed');
      case 403:
        return new CanvasError(
          'FORBIDDEN',
          'Canvas denied access to this resource',
        );
      case 404:
        return new CanvasError('NOT_FOUND', 'Canvas resource was not found');
      case 429:
        return new CanvasError(
          'RATE_LIMITED',
          'Canvas rate limit reached; please try again later',
        );
      default:
        return new CanvasError(
          'BAD_RESPONSE',
          `Canvas returned status ${String(status)} from ${this.config.baseUrl.hostname}`,
        );
    }
  }

  private isAbortError(error: unknown): boolean {
    if (!error || typeof error !== 'object' || !('name' in error)) return false;
    return error.name === 'AbortError' || error.name === 'TimeoutError';
  }

  private async waitForRetry(retryAfter: string | null): Promise<void> {
    if (!retryAfter || !/^\d+(?:\.\d+)?$/.test(retryAfter.trim())) return;
    const delayMs = Math.min(Number(retryAfter) * 1_000, MAX_RETRY_DELAY_MS);
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  }
}
