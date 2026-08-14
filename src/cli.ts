import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CanvasConfig } from './config.js';

export interface CanvasLifecycleServer {
  readonly connect: (transport: Transport) => Promise<void>;
  readonly close: () => Promise<void>;
}

export interface CanvasCliDependencies {
  readonly env: NodeJS.ProcessEnv;
  readonly loadConfig: (env: NodeJS.ProcessEnv) => Readonly<CanvasConfig>;
  readonly createServer: (
    config: Readonly<CanvasConfig>,
  ) => CanvasLifecycleServer;
  readonly createTransport: () => Transport;
  readonly cleanupDownloads: () => Promise<void>;
  readonly onceSignal: (
    signal: 'SIGINT' | 'SIGTERM',
    listener: () => void,
  ) => void;
  readonly stderr: (message: string) => void;
  readonly setExitCode: (code: 0 | 1) => void;
}

export async function startCanvasCli(
  dependencies: CanvasCliDependencies,
): Promise<void> {
  let server: CanvasLifecycleServer | undefined;
  let shutdownPromise: Promise<boolean> | undefined;
  let exitCode: 0 | 1 | undefined;

  const shutdown = (): Promise<boolean> => {
    shutdownPromise ??= settleShutdown(server, dependencies);
    return shutdownPromise;
  };
  const setExitCode = (code: 0 | 1): void => {
    if (exitCode === undefined || code > exitCode) {
      exitCode = code;
      dependencies.setExitCode(code);
    }
  };
  const handleSignal = (): void => {
    void shutdown().then((failed) => {
      setExitCode(failed ? 1 : 0);
    });
  };

  try {
    const config = dependencies.loadConfig(dependencies.env);
    server = dependencies.createServer(config);
    dependencies.onceSignal('SIGINT', handleSignal);
    dependencies.onceSignal('SIGTERM', handleSignal);
    await server.connect(dependencies.createTransport());
  } catch (error) {
    dependencies.stderr(`Canvas MCP startup failed: ${startupMessage(error)}`);
    await shutdown();
    setExitCode(1);
  }
}

async function settleShutdown(
  server: CanvasLifecycleServer | undefined,
  dependencies: CanvasCliDependencies,
): Promise<boolean> {
  const outcomes = await Promise.allSettled([
    Promise.resolve().then(() => server?.close()),
    Promise.resolve().then(() => dependencies.cleanupDownloads()),
  ]);
  const failed = outcomes.some(({ status }) => status === 'rejected');
  if (failed) {
    dependencies.stderr('Canvas MCP server failed to shut down cleanly.');
  }
  return failed;
}

function startupMessage(error: unknown): string {
  if (
    error instanceof Error &&
    /^(CANVAS_BASE_URL|CANVAS_API_TOKEN)\b/.test(error.message)
  ) {
    return error.message;
  }
  return 'Unable to start the server.';
}
