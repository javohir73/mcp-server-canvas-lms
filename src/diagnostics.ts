import { CanvasClient } from './canvas/client.js';
import { CanvasError, type CanvasErrorCode } from './canvas/errors.js';
import { loadConfig } from './config.js';

export interface ConnectionCheck {
  readonly code: string;
  readonly ok: boolean;
  readonly message: string;
}

export interface ConnectionReport {
  readonly ok: boolean;
  readonly checks: readonly ConnectionCheck[];
}

const CONFIG_HELP: Readonly<Record<string, string>> = {
  'CANVAS_BASE_URL is required':
    'Set CANVAS_BASE_URL to your university Canvas URL, for example https://canvas.example.edu.',
  'CANVAS_API_TOKEN is required':
    'Set CANVAS_API_TOKEN to your personal Canvas access token. Find it in Canvas: Account > Settings > Approved Integrations. If token creation is unavailable, contact your Canvas administrator.',
  'CANVAS_BASE_URL must be an absolute URL':
    'CANVAS_BASE_URL must be a complete Canvas URL starting with https://.',
  'CANVAS_BASE_URL must use HTTPS':
    'Use the https:// address of your university Canvas site.',
  'CANVAS_BASE_URL must not contain credentials':
    'Use a Canvas URL without an embedded username or password. Keep the access token in CANVAS_API_TOKEN.',
  'CANVAS_BASE_URL must be the Canvas origin without /api/v1':
    'Use only the Canvas site root in CANVAS_BASE_URL; remove /api/v1, course paths, query parameters and fragments.',
};

const ERROR_HELP: Readonly<Record<CanvasErrorCode, string>> = {
  UNAUTHORIZED:
    'Canvas rejected the access token. Check whether it expired or was revoked, replace CANVAS_API_TOKEN, and reconnect. Do not share the token.',
  FORBIDDEN:
    'Canvas denied course access. Check your enrollment and institutional API permissions with your Canvas administrator.',
  NOT_FOUND:
    'The Canvas API was not found. Check that your Canvas URL is the LMS site root rather than a university login portal.',
  RATE_LIMITED:
    'Canvas is rate-limiting requests. Wait a little and try again.',
  TIMEOUT:
    'Canvas did not respond in time. Check your internet connection and any required university VPN, then try again.',
  NETWORK:
    'Unable to reach Canvas. Check your internet connection, Canvas URL and any required university VPN, then try again.',
  BAD_RESPONSE:
    'Canvas returned an unexpected response. Confirm the Canvas URL is the LMS site root; Canvas may also be temporarily unavailable.',
  UNSAFE_URL:
    'Canvas redirected the request outside the configured site. Use the actual Canvas LMS URL rather than an SSO login link; contact support if it persists.',
};

/** A shareable report: no tokens, response bodies, course names or raw errors. */
export async function checkCanvasConnection(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ConnectionReport> {
  const checks: ConnectionCheck[] = [];
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  const supported = major > 20 || (major === 20 && minor >= 19);
  checks.push({
    code: 'RUNTIME',
    ok: supported,
    message: supported
      ? `Node.js ${process.versions.node} is supported.`
      : 'Install Node.js 20.19 or newer, then reopen your AI client.',
  });
  if (!supported) return { ok: false, checks };

  let config;
  try {
    config = loadConfig(env);
    checks.push({
      code: 'CONFIG',
      ok: true,
      message:
        'Canvas URL and access token are configured. The token is not shown.',
    });
  } catch (error) {
    const message =
      error instanceof Error ? CONFIG_HELP[error.message] : undefined;
    checks.push({
      code: 'CONFIG',
      ok: false,
      message:
        message ??
        'Check CANVAS_BASE_URL and CANVAS_API_TOKEN in your client settings.',
    });
    return { ok: false, checks };
  }

  try {
    const courses = await new CanvasClient(config, fetchImpl).get<unknown>(
      '/courses',
      { enrollment_state: 'active', per_page: 1 },
    );
    if (
      !Array.isArray(courses) ||
      !courses.every(
        (course: unknown) =>
          typeof course === 'object' &&
          course !== null &&
          'id' in course &&
          Number.isInteger(course.id) &&
          Number(course.id) > 0,
      )
    ) {
      throw new CanvasError('BAD_RESPONSE', 'Invalid course response');
    }
    checks.push({
      code: 'CANVAS',
      ok: true,
      message:
        courses.length === 0
          ? 'Connected to Canvas, but no active courses were returned. If this is unexpected, check your enrollment and the Canvas account you used.'
          : 'Connected to Canvas. Active course access works.',
    });
    return { ok: true, checks };
  } catch (error) {
    const code = error instanceof CanvasError ? error.code : 'NETWORK';
    checks.push({ code, ok: false, message: ERROR_HELP[code] });
    return { ok: false, checks };
  }
}
