import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { cleanupDownloads } from './canvas/download.js';
import { startCanvasCli } from './cli.js';
import { loadConfig } from './config.js';
import { createCanvasServer } from './server.js';
import { handleCanvasCommand } from './commands.js';

const handled = await handleCanvasCommand(process.argv.slice(2), {
  env: process.env,
  stdout: (message) => {
    console.log(message);
  },
  stderr: (message) => {
    console.error(message);
  },
  setExitCode: (code) => {
    process.exitCode = code;
  },
});

if (!handled)
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
