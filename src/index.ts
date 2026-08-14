import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { cleanupDownloads } from './canvas/download.js';
import { loadConfig } from './config.js';
import { createCanvasServer } from './server.js';

try {
  const config = loadConfig(process.env);
  const server = createCanvasServer(config);
  await server.connect(new StdioServerTransport());
  const shutdown = async (): Promise<void> => {
    try {
      await server.close();
      await cleanupDownloads();
      process.exit(0);
    } catch {
      console.error('Canvas MCP server failed to shut down cleanly.');
      process.exit(1);
    }
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown();
    });
  }
} catch (error) {
  console.error(`Canvas MCP startup failed: ${startupMessage(error)}`);
  process.exitCode = 1;
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
