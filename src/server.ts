import {
  McpServer,
  type ToolCallback,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { CanvasClient } from './canvas/client.js';
import type {
  DirectoryRemover,
  ExternalTransport,
  HostnameResolver,
  TemporaryDirectoryFactory,
} from './canvas/download.js';
import { CanvasError, type CanvasErrorCode } from './canvas/errors.js';
import type { CanvasConfig } from './config.js';
import { createAssignmentHandlers } from './tools/assignment-tools.js';
import { createContentHandlers } from './tools/content-tools.js';
import { createCourseHandlers } from './tools/course-tools.js';
import { createFileHandlers } from './tools/file-tools.js';

const positiveId = z.number().int().positive();
const optionalLimit = z.number().int().min(1).max(100).optional();
const readOnlyPrefix =
  'Read-only Canvas LMS access. All requests use Canvas GET endpoints; this server cannot modify Canvas.';

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const canvasErrorMessages: Readonly<Record<CanvasErrorCode, string>> = {
  UNAUTHORIZED: 'Canvas authentication failed.',
  FORBIDDEN: 'Canvas denied access to this resource.',
  NOT_FOUND: 'Canvas resource was not found.',
  RATE_LIMITED: 'Canvas rate limit reached. Please try again later.',
  TIMEOUT: 'Canvas request timed out. Please try again.',
  BAD_RESPONSE: 'Canvas returned an invalid response.',
  NETWORK: 'Canvas is unavailable. Please try again.',
  UNSAFE_URL: 'Canvas returned an unsafe URL.',
};

export interface CanvasServerOptions {
  readonly fetchImpl?: typeof fetch;
  readonly downloadFetch?: typeof fetch;
  readonly timezone?: string;
  readonly now?: () => Date;
  readonly createTempDirectory?: TemporaryDirectoryFactory;
  readonly resolveHostname?: HostnameResolver;
  readonly externalTransport?: ExternalTransport;
  readonly removeDirectory?: DirectoryRemover;
}

export function createCanvasServer(
  config: Readonly<CanvasConfig>,
  options: Readonly<CanvasServerOptions> = {},
): McpServer {
  const client = new CanvasClient(config, options.fetchImpl);
  const dependencies = {
    client,
    timezone:
      options.timezone ??
      (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
    now: options.now ?? (() => new Date()),
  };
  const courseHandlers = createCourseHandlers(dependencies);
  const assignmentHandlers = createAssignmentHandlers(dependencies);
  const contentHandlers = createContentHandlers(dependencies);
  const fileHandlers = createFileHandlers({
    ...dependencies,
    canvasOrigin: config.baseUrl,
    apiToken: config.apiToken,
    ...((options.downloadFetch ?? options.fetchImpl)
      ? { downloadFetch: options.downloadFetch ?? options.fetchImpl }
      : {}),
    ...(options.createTempDirectory
      ? { createTempDirectory: options.createTempDirectory }
      : {}),
    ...(options.resolveHostname
      ? { resolveHostname: options.resolveHostname }
      : {}),
    ...(options.externalTransport
      ? { externalTransport: options.externalTransport }
      : {}),
    ...(options.removeDirectory
      ? { removeDirectory: options.removeDirectory }
      : {}),
  });
  const server = new McpServer({
    name: 'mcp-server-canvas-lms',
    version: '0.1.0',
  });
  const safe = <Input>(handler: (input: Input) => Promise<CallToolResult>) =>
    safeTool(handler, config.baseUrl.hostname);
  const protocolTools = new Map<string, ProtocolTool>();
  const registerTool = <InputSchema extends z.ZodType>(
    name: string,
    toolConfig: {
      readonly description: string;
      readonly inputSchema: InputSchema;
      readonly annotations: typeof readOnlyAnnotations;
    },
    handler: (input: z.output<InputSchema>) => Promise<CallToolResult>,
  ): void => {
    server.registerTool(name, toolConfig, handler as ToolCallback<InputSchema>);
    protocolTools.set(name, {
      inputSchema: toolConfig.inputSchema,
      handler: (input) => handler(input as z.output<InputSchema>),
    });
  };

  registerTool(
    'canvas_list_courses',
    {
      description: `${readOnlyPrefix} List active courses, terms, and available current scores.`,
      inputSchema: z.strictObject({}),
      annotations: readOnlyAnnotations,
    },
    safe(courseHandlers.listCourses),
  );
  registerTool(
    'canvas_list_assignments',
    {
      description: `${readOnlyPrefix} List assignments for one course or all active courses.`,
      inputSchema: z.strictObject({
        course_id: positiveId.optional(),
        bucket: z.enum(['upcoming', 'overdue', 'past', 'all']).optional(),
        limit: optionalLimit,
      }),
      annotations: readOnlyAnnotations,
    },
    safe((input) =>
      assignmentHandlers.listAssignments({
        ...(input.course_id === undefined
          ? {}
          : { course_id: input.course_id }),
        ...(input.bucket === undefined ? {} : { bucket: input.bucket }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      }),
    ),
  );
  registerTool(
    'canvas_get_assignment',
    {
      description: `${readOnlyPrefix} Read one assignment's requirements, rubric, and submission summary.`,
      inputSchema: z.strictObject({
        course_id: positiveId,
        assignment_id: positiveId,
      }),
      annotations: readOnlyAnnotations,
    },
    safe(assignmentHandlers.getAssignment),
  );
  registerTool(
    'canvas_get_grades',
    {
      description: `${readOnlyPrefix} Read grade totals or one course's assignment breakdown.`,
      inputSchema: z.strictObject({ course_id: positiveId.optional() }),
      annotations: readOnlyAnnotations,
    },
    safe((input) =>
      courseHandlers.getGrades(
        input.course_id === undefined ? {} : { course_id: input.course_id },
      ),
    ),
  );
  registerTool(
    'canvas_get_submission',
    {
      description: `${readOnlyPrefix} Read the current user's submission, comments, and rubric assessment.`,
      inputSchema: z.strictObject({
        course_id: positiveId,
        assignment_id: positiveId,
      }),
      annotations: readOnlyAnnotations,
    },
    safe(assignmentHandlers.getSubmission),
  );
  registerTool(
    'canvas_get_syllabus',
    {
      description: `${readOnlyPrefix} Read one course syllabus as cleaned text.`,
      inputSchema: z.strictObject({ course_id: positiveId }),
      annotations: readOnlyAnnotations,
    },
    safe(courseHandlers.getSyllabus),
  );
  registerTool(
    'canvas_list_announcements',
    {
      description: `${readOnlyPrefix} List recent announcements for one or all active courses.`,
      inputSchema: z.strictObject({
        course_id: positiveId.optional(),
        since_days: z.number().int().min(1).max(365).optional(),
      }),
      annotations: readOnlyAnnotations,
    },
    safe((input) =>
      contentHandlers.listAnnouncements({
        ...(input.course_id === undefined
          ? {}
          : { course_id: input.course_id }),
        ...(input.since_days === undefined
          ? {}
          : { since_days: input.since_days }),
      }),
    ),
  );
  registerTool(
    'canvas_list_modules',
    {
      description: `${readOnlyPrefix} List one course's modules and module items.`,
      inputSchema: z.strictObject({ course_id: positiveId }),
      annotations: readOnlyAnnotations,
    },
    safe(contentHandlers.listModules),
  );
  registerTool(
    'canvas_get_page',
    {
      description: `${readOnlyPrefix} Read one course page by its Canvas page URL slug.`,
      inputSchema: z.strictObject({
        course_id: positiveId,
        page_url: z
          .string()
          .trim()
          .min(1)
          .max(255)
          .regex(/^[^/?#]+$/),
      }),
      annotations: readOnlyAnnotations,
    },
    safe(contentHandlers.getPage),
  );
  registerTool(
    'canvas_list_files',
    {
      description: `${readOnlyPrefix} List files in one course with an optional search term.`,
      inputSchema: z.strictObject({
        course_id: positiveId,
        search: z.string().optional(),
      }),
      annotations: readOnlyAnnotations,
    },
    safe((input) =>
      fileHandlers.listFiles({
        course_id: input.course_id,
        ...(input.search === undefined ? {} : { search: input.search }),
      }),
    ),
  );
  registerTool(
    'canvas_read_file',
    {
      description: `${readOnlyPrefix} Read a course file. PDF, DOCX and PPTX return extracted text with page, paragraph or slide references and a Canvas source link. Scans require OCR, which is not included. Other files are safely downloaded.`,
      inputSchema: z.strictObject({
        course_id: positiveId,
        file_id: positiveId,
      }),
      annotations: readOnlyAnnotations,
    },
    safe(fileHandlers.readFile),
  );

  installSanitizedCallBoundary(server, protocolTools);

  return server;
}

interface ProtocolTool {
  readonly inputSchema: z.ZodType;
  readonly handler: (input: unknown) => Promise<CallToolResult>;
}

function installSanitizedCallBoundary(
  server: McpServer,
  tools: ReadonlyMap<string, ProtocolTool>,
): void {
  server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.get(request.params.name);
    if (!tool) return errorResult('Canvas tool was not found.');
    const parsed = await tool.inputSchema.safeParseAsync(
      request.params.arguments ?? {},
    );
    if (!parsed.success) return errorResult('Invalid Canvas tool input.');
    return tool.handler(parsed.data);
  });
}

function safeTool<Input>(
  handler: (input: Input) => Promise<CallToolResult>,
  canvasHostname: string,
): (input: Input) => Promise<CallToolResult> {
  return async (input) => {
    try {
      return await handler(input);
    } catch (error) {
      if (error instanceof CanvasError) {
        return errorResult(canvasErrorMessages[error.code]);
      }
      if (error instanceof z.ZodError) {
        return errorResult('Invalid Canvas tool input.');
      }
      console.error(
        `Unexpected Canvas tool error (${errorClass(error)}) for ${canvasHostname}`,
      );
      return errorResult('Canvas request failed unexpectedly.');
    }
  };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function errorClass(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
}
