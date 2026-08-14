export interface CanvasConfig {
  readonly baseUrl: URL;
  readonly apiToken: string;
  readonly timeoutMs: number;
  readonly maxPages: number;
}

export function loadConfig(env: NodeJS.ProcessEnv): Readonly<CanvasConfig> {
  const rawUrl = env.CANVAS_BASE_URL?.trim();
  const apiToken = env.CANVAS_API_TOKEN?.trim();
  if (!rawUrl) throw new Error('CANVAS_BASE_URL is required');
  if (!apiToken) throw new Error('CANVAS_API_TOKEN is required');

  let baseUrl: URL;
  try {
    baseUrl = new URL(rawUrl);
  } catch {
    throw new Error('CANVAS_BASE_URL must be an absolute URL');
  }

  const localhost =
    baseUrl.hostname === 'localhost' || baseUrl.hostname === '127.0.0.1';
  if (
    baseUrl.protocol !== 'https:' &&
    !(localhost && baseUrl.protocol === 'http:')
  ) {
    throw new Error('CANVAS_BASE_URL must use HTTPS');
  }
  if (baseUrl.username || baseUrl.password) {
    throw new Error('CANVAS_BASE_URL must not contain credentials');
  }
  if (baseUrl.pathname !== '/' && baseUrl.pathname !== '') {
    throw new Error(
      'CANVAS_BASE_URL must be the Canvas origin without /api/v1',
    );
  }
  baseUrl.pathname = '/';
  return Object.freeze({ baseUrl, apiToken, timeoutMs: 15_000, maxPages: 20 });
}
