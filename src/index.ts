import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { cleanupDownloads } from './canvas/download.js';
import { startCanvasCli } from './cli.js';
import { loadConfig } from './config.js';
import { createCanvasServer } from './server.js';

await startCanvasCli({
  env: process.env,
  loadConfig,
  createServer: createCanvasServer,
  createTransport: () => new StdioServerTransport(),
  cleanupDownloads,
  onceSignal: (signal, listener) => {
    process.once(signal, listener);
  },
  stderr: (message) => {
    console.error(message);
  },
  setExitCode: (code) => {
    process.exitCode = code;
  },
});
