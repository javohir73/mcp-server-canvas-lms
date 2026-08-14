import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { describe, expect, test, vi } from 'vitest';
import type { CanvasConfig } from '../src/config.js';
import {
  startCanvasCli,
  type CanvasCliDependencies,
  type CanvasLifecycleServer,
} from '../src/cli.js';

const config: Readonly<CanvasConfig> = Object.freeze({
  baseUrl: new URL('https://canvas.example.edu/'),
  apiToken: 'lifecycle-secret-token',
  timeoutMs: 100,
  maxPages: 2,
});

describe('Canvas CLI lifecycle', () => {
  test('coalesces racing SIGINT and SIGTERM into one successful shutdown', async () => {
    const harness = lifecycleHarness();

    await startCanvasCli(harness.dependencies);
    harness.signal('SIGINT');
    harness.signal('SIGTERM');

    await vi.waitFor(() => {
      expect(harness.setExitCode).toHaveBeenCalledWith(0);
    });
    expect(harness.server.close).toHaveBeenCalledTimes(1);
    expect(harness.cleanupDownloads).toHaveBeenCalledTimes(1);
    expect(harness.setExitCode).toHaveBeenCalledTimes(1);
    expect(harness.stderr).not.toHaveBeenCalled();
  });

  test('attempts cleanup and exits unsuccessfully when server close rejects', async () => {
    const harness = lifecycleHarness({
      close: vi
        .fn()
        .mockRejectedValue(new Error('close lifecycle-secret-token')),
    });

    await startCanvasCli(harness.dependencies);
    harness.signal('SIGTERM');

    await vi.waitFor(() => {
      expect(harness.setExitCode).toHaveBeenCalledWith(1);
    });
    expect(harness.server.close).toHaveBeenCalledTimes(1);
    expect(harness.cleanupDownloads).toHaveBeenCalledTimes(1);
    expect(harness.stderr).toHaveBeenCalledExactlyOnceWith(
      'Canvas MCP server failed to shut down cleanly.',
    );
    expect(JSON.stringify(harness.stderr.mock.calls)).not.toContain(
      'lifecycle-secret-token',
    );
  });

  test('attempts server close and exits unsuccessfully when cleanup rejects', async () => {
    const harness = lifecycleHarness({
      cleanupDownloads: vi
        .fn()
        .mockRejectedValue(new Error('cleanup lifecycle-secret-token')),
    });

    await startCanvasCli(harness.dependencies);
    harness.signal('SIGINT');

    await vi.waitFor(() => {
      expect(harness.setExitCode).toHaveBeenCalledWith(1);
    });
    expect(harness.server.close).toHaveBeenCalledTimes(1);
    expect(harness.cleanupDownloads).toHaveBeenCalledTimes(1);
    expect(harness.stderr).toHaveBeenCalledExactlyOnceWith(
      'Canvas MCP server failed to shut down cleanly.',
    );
  });

  test('closes and cleans a partially connected server after sanitized startup failure', async () => {
    const harness = lifecycleHarness({
      connect: vi
        .fn()
        .mockRejectedValue(new Error('connect lifecycle-secret-token')),
      close: vi
        .fn()
        .mockRejectedValue(new Error('close lifecycle-secret-token')),
      cleanupDownloads: vi
        .fn()
        .mockRejectedValue(new Error('cleanup lifecycle-secret-token')),
    });

    await startCanvasCli(harness.dependencies);

    expect(harness.server.close).toHaveBeenCalledTimes(1);
    expect(harness.cleanupDownloads).toHaveBeenCalledTimes(1);
    expect(harness.setExitCode).toHaveBeenLastCalledWith(1);
    expect(harness.stderr.mock.calls).toEqual([
      ['Canvas MCP startup failed: Unable to start the server.'],
      ['Canvas MCP server failed to shut down cleanly.'],
    ]);
    expect(JSON.stringify(harness.stderr.mock.calls)).not.toContain(
      'lifecycle-secret-token',
    );
  });
});

interface HarnessOverrides {
  readonly connect?: CanvasLifecycleServer['connect'];
  readonly close?: CanvasLifecycleServer['close'];
  readonly cleanupDownloads?: CanvasCliDependencies['cleanupDownloads'];
}

function lifecycleHarness(overrides: HarnessOverrides = {}) {
  const signalListeners = new Map<NodeJS.Signals, () => void>();
  const server: CanvasLifecycleServer = {
    connect: overrides.connect ?? vi.fn().mockResolvedValue(undefined),
    close: overrides.close ?? vi.fn().mockResolvedValue(undefined),
  };
  const cleanupDownloads =
    overrides.cleanupDownloads ?? vi.fn().mockResolvedValue(undefined);
  const stderr = vi.fn();
  const setExitCode = vi.fn();
  const dependencies: CanvasCliDependencies = {
    env: {},
    loadConfig: vi.fn().mockReturnValue(config),
    createServer: vi.fn().mockReturnValue(server),
    createTransport: vi.fn().mockReturnValue({} as Transport),
    cleanupDownloads,
    onceSignal: (signal, listener) => {
      signalListeners.set(signal, listener);
    },
    stderr,
    setExitCode,
  };
  return {
    dependencies,
    server: {
      connect: vi.mocked(server.connect),
      close: vi.mocked(server.close),
    },
    cleanupDownloads: vi.mocked(cleanupDownloads),
    stderr,
    setExitCode,
    signal(signal: NodeJS.Signals) {
      const listener = signalListeners.get(signal);
      if (!listener) throw new Error(`Missing listener for ${signal}`);
      listener();
    },
  };
}
