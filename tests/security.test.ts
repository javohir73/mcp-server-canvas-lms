import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { CanvasConfig } from '../src/config.js';
import { createCanvasServer } from '../src/server.js';

const TOKEN = 'secret-token-that-must-not-leak';
const AUTHORIZATION = `Bearer ${TOKEN}`;
const config: Readonly<CanvasConfig> = Object.freeze({
  baseUrl: new URL('https://canvas.example.edu/'),
  apiToken: TOKEN,
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
  vi.restoreAllMocks();
});

describe('read-only MCP security boundary', () => {
  test('all eleven tools produce GET-only Canvas and file traffic', async () => {
    const requests: RequestRecord[] = [];
    const { client } = await connectCanvasServer(routingFetch(requests));
    const calls = [
      ['canvas_list_courses', {}],
      ['canvas_list_assignments', { course_id: 1, bucket: 'all', limit: 1 }],
      ['canvas_get_assignment', { course_id: 1, assignment_id: 2 }],
      ['canvas_get_grades', { course_id: 1 }],
      ['canvas_get_submission', { course_id: 1, assignment_id: 2 }],
      ['canvas_get_syllabus', { course_id: 1 }],
      ['canvas_list_announcements', { course_id: 1, since_days: 30 }],
      ['canvas_list_modules', { course_id: 1 }],
      ['canvas_get_page', { course_id: 1, page_url: 'welcome' }],
      ['canvas_list_files', { course_id: 1, search: 'notes' }],
      ['canvas_read_file', { course_id: 1, file_id: 9 }],
    ] as const;

    for (const [name, arguments_] of calls) {
      const result = await client.callTool({ name, arguments: arguments_ });
      expect(result.isError, name).not.toBe(true);
    }

    expect(requests.length).toBeGreaterThanOrEqual(calls.length);
    expect(requests.every(({ method }) => method === 'GET')).toBe(true);
  });

  test.each([
    [401, 'Canvas authentication failed.'],
    [403, 'Canvas denied access to this resource.'],
    [404, 'Canvas resource was not found.'],
    [429, 'Canvas rate limit reached. Please try again later.'],
  ] as const)(
    'returns a sanitized MCP error for Canvas status %i',
    async (status, expectedMessage) => {
      const { client } = await connectCanvasServer(async () =>
        jsonResponse({ error: AUTHORIZATION }, status),
      );

      const result = await client.callTool({
        name: 'canvas_list_courses',
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain(expectedMessage);
      expect(resultText(result)).not.toContain(TOKEN);
      expect(resultText(result)).not.toContain(AUTHORIZATION);
    },
  );

  test('sanitizes unexpected failures and logs only their class and Canvas hostname', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = await connectCanvasServer(async () => jsonResponse([]), {
      now: () => {
        throw new TypeError(AUTHORIZATION);
      },
    });

    const result = await client.callTool({
      name: 'canvas_list_assignments',
      arguments: { course_id: 1 },
    });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe('Canvas request failed unexpectedly.');
    expect(resultText(result)).not.toContain(TOKEN);
    expect(stderr).toHaveBeenCalledExactlyOnceWith(
      'Unexpected Canvas tool error (TypeError) for canvas.example.edu',
    );
  });

  test.each([
    [
      'timeout',
      async () => {
        throw new DOMException(AUTHORIZATION, 'AbortError');
      },
      'Canvas request timed out. Please try again.',
    ],
    [
      'malformed JSON',
      async () =>
        new Response(`not-json ${AUTHORIZATION}`, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      'Canvas returned an invalid response.',
    ],
  ] as const)(
    'returns a sanitized MCP error for %s',
    async (_caseName, fetchImpl, expectedMessage) => {
      const { client } = await connectCanvasServer(fetchImpl);

      const result = await client.callTool({
        name: 'canvas_list_courses',
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain(expectedMessage);
      expect(resultText(result)).not.toContain(TOKEN);
      expect(resultText(result)).not.toContain(AUTHORIZATION);
    },
  );
});

interface RequestRecord {
  readonly url: string;
  readonly method: string | undefined;
}

function routingFetch(requests: RequestRecord[]): typeof fetch {
  return async (input, init) => {
    const url = new URL(requestUrl(input));
    requests.push({ url: url.href, method: init?.method });

    if (url.pathname === '/api/v1/courses') return jsonResponse([]);
    if (url.pathname === '/api/v1/courses/1') {
      return jsonResponse({
        id: 1,
        name: 'Example course',
        syllabus_body: '<p>Course syllabus</p>',
      });
    }
    if (url.pathname === '/api/v1/courses/1/assignments') {
      return jsonResponse([]);
    }
    if (url.pathname === '/api/v1/courses/1/assignments/2') {
      return jsonResponse({ id: 2, course_id: 1, name: 'Essay' });
    }
    if (url.pathname === '/api/v1/courses/1/assignments/2/submissions/self') {
      return jsonResponse({ id: 3, workflow_state: 'submitted' });
    }
    if (url.pathname === '/api/v1/announcements') return jsonResponse([]);
    if (url.pathname === '/api/v1/courses/1/modules') return jsonResponse([]);
    if (url.pathname === '/api/v1/courses/1/pages/welcome') {
      return jsonResponse({ url: 'welcome', title: 'Welcome', body: 'Hello' });
    }
    if (url.pathname === '/api/v1/courses/1/files') {
      return jsonResponse([
        {
          id: 9,
          display_name: 'notes.txt',
          content_type: 'text/plain',
          url: 'https://canvas.example.edu/files/9/download',
        },
      ]);
    }
    if (url.pathname === '/api/v1/files/9') {
      return jsonResponse({
        id: 9,
        display_name: 'notes.txt',
        content_type: 'text/plain',
        url: 'https://canvas.example.edu/files/9/download',
      });
    }
    if (url.pathname === '/files/9/download') {
      return new Response('Read-only notes', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    }
    return jsonResponse({ error: 'unexpected route' }, 404);
  };
}

async function connectCanvasServer(
  fetchImpl: typeof fetch,
  options: { readonly now?: () => Date } = {},
): Promise<{ client: Client; server: McpServer }> {
  const server = createCanvasServer(config, {
    fetchImpl,
    timezone: 'Australia/Sydney',
    now: options.now ?? (() => new Date('2026-08-14T00:00:00.000Z')),
  });
  const client = new Client({ name: 'canvas-security-test', version: '1.0.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  openConnections.push({ client, server });
  return { client, server };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function resultText(result: Awaited<ReturnType<Client['callTool']>>): string {
  if (!('content' in result) || !Array.isArray(result.content)) {
    throw new TypeError('Expected an immediate MCP tool result');
  }
  const content = result.content as CallToolResult['content'];
  return content
    .filter(
      (item): item is Extract<(typeof content)[number], { type: 'text' }> =>
        item.type === 'text',
    )
    .map(({ text }) => text)
    .join('\n');
}
