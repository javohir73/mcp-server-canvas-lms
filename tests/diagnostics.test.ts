import { describe, expect, it, vi } from 'vitest';
import { checkCanvasConnection } from '../src/diagnostics.js';
import { handleCanvasCommand } from '../src/commands.js';

const env = {
  CANVAS_BASE_URL: 'https://canvas.example.edu',
  CANVAS_API_TOKEN: 'never-print-this-test-token',
};

describe('connection diagnostics', () => {
  it.each([
    [{}, 'CONFIG'],
    [{ CANVAS_BASE_URL: env.CANVAS_BASE_URL }, 'CONFIG'],
    [
      { ...env, CANVAS_BASE_URL: 'https://canvas.example.edu/courses/1' },
      'CONFIG',
    ],
  ])(
    'explains incomplete configuration without contacting Canvas',
    async (settings, code) => {
      const fetchImpl = vi.fn<typeof fetch>();
      const report = await checkCanvasConnection(settings, fetchImpl);
      expect(report.ok).toBe(false);
      expect(
        report.checks.some((check) => check.code === code && !check.ok),
      ).toBe(true);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(JSON.stringify(report)).not.toContain(env.CANVAS_API_TOKEN);
    },
  );

  it('checks access with one bounded read-only request and excludes personal data', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify([{ id: 10, name: 'PRIVATE COURSE NAME' }])),
      );
    const report = await checkCanvasConnection(env, fetchImpl);
    expect(report.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(
      'https://canvas.example.edu/api/v1/courses?enrollment_state=active&per_page=1',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: `Bearer ${env.CANVAS_API_TOKEN}`,
        }),
      }),
    );
    expect(JSON.stringify(report)).not.toContain('PRIVATE COURSE NAME');
    expect(JSON.stringify(report)).not.toContain(env.CANVAS_API_TOKEN);
  });

  it('treats an empty course list as a working connection with useful guidance', async () => {
    const report = await checkCanvasConnection(
      env,
      async () => new Response('[]'),
    );
    expect(report.ok).toBe(true);
    expect(JSON.stringify(report)).toMatch(/no active courses/i);
  });

  it.each([
    [401, 'UNAUTHORIZED', /token/i],
    [403, 'FORBIDDEN', /permission|administrator/i],
    [404, 'NOT_FOUND', /Canvas URL/i],
    [429, 'RATE_LIMITED', /try again|wait/i],
    [500, 'BAD_RESPONSE', /response|unavailable/i],
  ])(
    'turns HTTP %s into safe, actionable guidance',
    async (status, code, guidance) => {
      const report = await checkCanvasConnection(
        env,
        async () =>
          new Response('private-body never-print-this-test-token', { status }),
      );
      expect(report.ok).toBe(false);
      expect(
        report.checks.some((check) => check.code === code && !check.ok),
      ).toBe(true);
      expect(JSON.stringify(report)).toMatch(guidance);
      expect(JSON.stringify(report)).not.toContain('private-body');
      expect(JSON.stringify(report)).not.toContain(env.CANVAS_API_TOKEN);
    },
  );

  it.each([
    [
      new Error('network private details never-print-this-test-token'),
      'NETWORK',
    ],
    [new DOMException('private timeout', 'TimeoutError'), 'TIMEOUT'],
  ])('sanitizes connection exceptions', async (error, code) => {
    const report = await checkCanvasConnection(env, async () => {
      throw error;
    });
    expect(report.ok).toBe(false);
    expect(report.checks.some((check) => check.code === code)).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(/private|never-print/);
  });

  it.each(['<html>Sign in</html>', '{"login":"private"}'])(
    'rejects a login page or wrong response shape',
    async (body) => {
      const report = await checkCanvasConnection(
        env,
        async () => new Response(body),
      );
      expect(report.ok).toBe(false);
      expect(report.checks.some((check) => check.code === 'BAD_RESPONSE')).toBe(
        true,
      );
    },
  );
});

function commandHarness(
  settings: NodeJS.ProcessEnv = env,
  fetchImpl: typeof fetch = async () => new Response('[]'),
) {
  const stdout = vi.fn();
  const stderr = vi.fn();
  const setExitCode = vi.fn();
  return { env: settings, fetchImpl, stdout, stderr, setExitCode };
}

describe('explicit CLI commands', () => {
  it('leaves the no-argument MCP startup silent', async () => {
    const harness = commandHarness();
    expect(await handleCanvasCommand([], harness)).toBe(false);
    expect(harness.stdout).not.toHaveBeenCalled();
    expect(harness.stderr).not.toHaveBeenCalled();
  });

  it('shows help even without configuration', async () => {
    const harness = commandHarness({});
    expect(await handleCanvasCommand(['--help'], harness)).toBe(true);
    expect(harness.stdout.mock.calls.join('\n')).toContain('--doctor');
    expect(harness.setExitCode).toHaveBeenCalledWith(0);
  });

  it('prints a shareable JSON report and exits successfully on connection success', async () => {
    const harness = commandHarness();
    expect(await handleCanvasCommand(['--doctor', '--json'], harness)).toBe(
      true,
    );
    const report = JSON.parse(harness.stdout.mock.calls[0]![0]) as {
      ok: boolean;
    };
    expect(report.ok).toBe(true);
    expect(harness.setExitCode).toHaveBeenCalledWith(0);
    expect(harness.stdout.mock.calls.join('\n')).not.toContain(
      env.CANVAS_API_TOKEN,
    );
  });

  it('exits unsuccessfully and explains missing settings', async () => {
    const harness = commandHarness({});
    await handleCanvasCommand(['--doctor'], harness);
    expect(harness.stdout.mock.calls.join('\n')).toMatch(/CANVAS_BASE_URL/);
    expect(harness.setExitCode).toHaveBeenCalledWith(1);
  });

  it('rejects unknown arguments without echoing a token passed by mistake', async () => {
    const harness = commandHarness();
    expect(
      await handleCanvasCommand(['--token', env.CANVAS_API_TOKEN], harness),
    ).toBe(true);
    expect(harness.setExitCode).toHaveBeenCalledWith(2);
    expect(harness.stderr.mock.calls.join('\n')).toContain('--help');
    expect(harness.stderr.mock.calls.join('\n')).not.toContain(
      env.CANVAS_API_TOKEN,
    );
  });
});
