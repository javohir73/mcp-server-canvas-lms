import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, test } from 'vitest';
import type { CanvasConfig } from '../src/config.js';
import { createCanvasServer } from '../src/server.js';

const TOOL_NAMES = [
  'canvas_get_assignment',
  'canvas_get_grades',
  'canvas_get_page',
  'canvas_get_submission',
  'canvas_get_syllabus',
  'canvas_get_weekly_overview',
  'canvas_list_announcements',
  'canvas_list_assignments',
  'canvas_list_courses',
  'canvas_list_files',
  'canvas_list_modules',
  'canvas_read_file',
] as const;

const config: Readonly<CanvasConfig> = Object.freeze({
  baseUrl: new URL('https://canvas.example.edu/'),
  apiToken: 'test-token',
  timeoutMs: 100,
  maxPages: 2,
});

const openConnections: Array<{ client: Client; server: McpServer }> = [];

afterEach(async () => {
  await Promise.all(
    openConnections.splice(0).map(async ({ client, server }) => {
      await client.close();
      await server.close();
    }),
  );
});

describe('Canvas MCP tool registration', () => {
  test('discovers exactly the twelve approved read-only tools', async () => {
    const { client } = await connectCanvasServer();

    const result = await client.listTools();

    expect(result.tools.map(({ name }) => name).sort()).toEqual(TOOL_NAMES);
    expect(
      result.tools.every(({ description }) =>
        description?.startsWith('Read-only Canvas LMS access.'),
      ),
    ).toBe(true);
  });

  test.each([
    ['canvas_list_assignments', 'course_id', {}],
    ['canvas_get_assignment', 'course_id', { assignment_id: 2 }],
    ['canvas_get_assignment', 'assignment_id', { course_id: 1 }],
    ['canvas_get_grades', 'course_id', {}],
    ['canvas_get_submission', 'course_id', { assignment_id: 2 }],
    ['canvas_get_submission', 'assignment_id', { course_id: 1 }],
    ['canvas_get_syllabus', 'course_id', {}],
    ['canvas_list_announcements', 'course_id', {}],
    ['canvas_list_modules', 'course_id', {}],
    ['canvas_get_page', 'course_id', { page_url: 'welcome' }],
    ['canvas_list_files', 'course_id', {}],
    ['canvas_read_file', 'course_id', { file_id: 9 }],
    ['canvas_read_file', 'file_id', { course_id: 1 }],
  ] as const)(
    '%s rejects invalid %s values at the MCP boundary',
    async (toolName, field, validArguments) => {
      const { client } = await connectCanvasServer();

      for (const invalidValue of [0, -1, 1.5, '1']) {
        const result = await client.callTool({
          name: toolName,
          arguments: { ...validArguments, [field]: invalidValue },
        });
        expectFixedInputError(
          result,
          `${String(field)}=${String(invalidValue)}`,
        );
      }
    },
  );

  test('enforces assignment bucket values and the 1 through 100 limit', async () => {
    const { client } = await connectCanvasServer();

    for (const bucket of ['soon', '', 1]) {
      await expectToolError(client, 'canvas_list_assignments', { bucket });
    }
    for (const limit of [0, 101, 1.5, '10']) {
      await expectToolError(client, 'canvas_list_assignments', { limit });
    }

    for (const bucket of ['upcoming', 'overdue', 'past', 'all']) {
      await expectToolSuccess(client, 'canvas_list_assignments', {
        bucket,
        limit: 1,
      });
    }
    await expectToolSuccess(client, 'canvas_list_assignments', { limit: 100 });
  });

  test('enforces the 1 through 365 announcement window', async () => {
    const { client } = await connectCanvasServer();

    for (const since_days of [0, 366, 1.5, '30']) {
      await expectToolError(client, 'canvas_list_announcements', {
        course_id: 1,
        since_days,
      });
    }
    await expectToolSuccess(client, 'canvas_list_announcements', {
      course_id: 1,
      since_days: 1,
    });
    await expectToolSuccess(client, 'canvas_list_announcements', {
      course_id: 1,
      since_days: 365,
    });
  });

  test('rejects unrecognized input properties', async () => {
    const { client } = await connectCanvasServer();

    await expectToolError(client, 'canvas_list_courses', {
      arbitrary_path: '/api/v1/users',
    });
  });

  test('validates overview windows, limits and timezone before fetching data', async () => {
    let requests = 0;
    const { client } = await connectCanvasServer(async () => {
      requests += 1;
      return new Response('[]');
    });
    for (const input of [
      { days_ahead: 0 },
      { days_ahead: 31 },
      { since_days: '7' },
      { since_days: 31 },
      { limit: 51 },
      { timezone: 'not/a/timezone' },
      { timezone: '' },
      { user_id: 1 },
    ]) {
      await expectToolError(client, 'canvas_get_weekly_overview', input);
    }
    expect(requests).toBe(0);
    await expectToolSuccess(client, 'canvas_get_weekly_overview', {
      timezone: 'Australia/Sydney',
      days_ahead: 7,
    });
    expect(requests).toBe(1);
  });
});

async function connectCanvasServer(
  fetchImpl: typeof fetch = emptyListFetch,
): Promise<{ client: Client; server: McpServer }> {
  const server = createCanvasServer(config, {
    fetchImpl,
    timezone: 'Australia/Sydney',
    now: () => new Date('2026-08-14T00:00:00.000Z'),
  });
  const client = new Client({ name: 'canvas-server-test', version: '1.0.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  openConnections.push({ client, server });
  return { client, server };
}

const emptyListFetch: typeof fetch = async () =>
  new Response('[]', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

async function expectToolError(
  client: Client,
  name: string,
  arguments_: Record<string, unknown>,
): Promise<void> {
  const result = await client.callTool({ name, arguments: arguments_ });
  expectFixedInputError(result);
}

async function expectToolSuccess(
  client: Client,
  name: string,
  arguments_: Record<string, unknown>,
): Promise<void> {
  const result = await client.callTool({ name, arguments: arguments_ });
  expect(result.isError).not.toBe(true);
}

function expectFixedInputError(
  result: Awaited<ReturnType<Client['callTool']>>,
  message?: string,
): void {
  expect(result.isError, message).toBe(true);
  expect(immediateResult(result).content, message).toEqual([
    { type: 'text', text: 'Invalid Canvas tool input.' },
  ]);
  const serialized = JSON.stringify(result);
  expect(serialized, message).not.toContain('test-token');
  expect(serialized, message).not.toContain('Authorization');
  expect(serialized, message).not.toContain('Zod');
  expect(serialized, message).not.toContain('expected');
  expect(serialized, message).not.toContain('schema');
}

function immediateResult(
  result: Awaited<ReturnType<Client['callTool']>>,
): CallToolResult {
  if (!('content' in result) || !Array.isArray(result.content)) {
    throw new TypeError('Expected an immediate MCP tool result');
  }
  return result as CallToolResult;
}
