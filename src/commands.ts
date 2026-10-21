import { checkCanvasConnection } from './diagnostics.js';

interface CommandDependencies {
  readonly env: NodeJS.ProcessEnv;
  readonly stdout: (message: string) => void;
  readonly stderr: (message: string) => void;
  readonly setExitCode: (code: 0 | 1 | 2) => void;
  readonly fetchImpl?: typeof fetch;
}

const HELP = `Canvas LMS MCP Server

Usage:
  mcp-server-canvas-lms                  Start the MCP server
  mcp-server-canvas-lms --doctor         Check your Canvas connection
  mcp-server-canvas-lms --doctor --json  Print a shareable diagnostic report
  mcp-server-canvas-lms --help           Show this help

Set CANVAS_BASE_URL to your university Canvas site root and CANVAS_API_TOKEN
to your personal Canvas token. Keep the token in your client's private settings.
Doctor reads those environment variables; it cannot see another app's saved settings.
Never pass your token as a command-line argument.

Setup: https://github.com/javohir73/mcp-server-canvas-lms#readme`;

/** Returns false only when the caller should start the normal MCP transport. */
export async function handleCanvasCommand(
  args: readonly string[],
  dependencies: CommandDependencies,
): Promise<boolean> {
  if (args.length === 0) return false;
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    dependencies.stdout(HELP);
    dependencies.setExitCode(0);
    return true;
  }
  if (
    args[0] === '--doctor' &&
    (args.length === 1 || (args.length === 2 && args[1] === '--json'))
  ) {
    const report = await checkCanvasConnection(
      dependencies.env,
      dependencies.fetchImpl,
    );
    dependencies.stdout(
      args[1] === '--json'
        ? JSON.stringify(report, null, 2)
        : [
            'Canvas connection check',
            ...report.checks.map(
              (check) => `${check.ok ? 'OK' : 'FIX'}: ${check.message}`,
            ),
            '',
            report.ok
              ? 'Connection check passed. Individual courses and files may have additional restrictions.'
              : 'Fix the issue above, then run the check again.',
          ].join('\n'),
    );
    dependencies.setExitCode(report.ok ? 0 : 1);
    return true;
  }
  dependencies.stderr(
    'Unknown command. Run mcp-server-canvas-lms --help for usage.',
  );
  dependencies.setExitCode(2);
  return true;
}
