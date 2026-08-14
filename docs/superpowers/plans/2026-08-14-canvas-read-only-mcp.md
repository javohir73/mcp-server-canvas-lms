# Read-Only Canvas LMS MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, verify, document, and prepare version `0.1.0` of `mcp-server-canvas-lms`, an npm-distributed Canvas LMS MCP server with exactly eleven structurally read-only tools.

**Architecture:** A validated configuration layer feeds a fetch-based Canvas client whose only public network method is `get`. Focused handler modules convert fixed Canvas endpoints into stable text results, while one stdio entry point registers the approved tool inventory with the official MCP SDK. Tests exercise handlers with a fake HTTP transport and enforce the GET-only, same-origin, credential-redaction, and eleven-tool boundaries.

**Tech Stack:** Node.js 20.19+, TypeScript 6, npm, `@modelcontextprotocol/sdk` 1.30, Zod 4, `html-to-text` 10, Vitest 4, ESLint 10, Prettier 3, tsup 8, GitHub Actions, npm trusted publishing.

**Spec:** `docs/superpowers/specs/2026-08-14-canvas-read-only-mcp-design.md`

## Global Constraints

- Package name is exactly `mcp-server-canvas-lms`; initial version is exactly `0.1.0`; license is MIT.
- Support Node.js `>=20.19.0` and npm as the package manager.
- Runtime dependencies are limited to `@modelcontextprotocol/sdk`, `zod`, and `html-to-text`.
- The transport is stdio only; do not add HTTP, Docker, remote hosting, persistence, analytics, telemetry, or a setup wizard.
- Register exactly the eleven `canvas_` tools named in the specification.
- Canvas API traffic must use `GET` only. Do not add a generic method parameter or any mutation helper.
- Require `CANVAS_BASE_URL` and `CANVAS_API_TOKEN`; never log, persist, return, or interpolate the token into an error.
- Use fixed Canvas API route templates, same-origin pagination, bounded retries, bounded pages, and request timeouts.
- Automated tests use fictional fixtures and fake HTTP responses only; no real Canvas token or network access.
- Use test-driven development and commit after each task passes its focused checks.

## File Map

- `package.json`: package metadata, executable, exports, scripts, dependency versions, and published file allowlist.
- `package-lock.json`: reproducible npm dependency graph.
- `tsconfig.json`, `tsconfig.build.json`, `tsup.config.ts`: strict TypeScript and distributable ESM build.
- `eslint.config.js`, `.prettierrc.json`: static style checks.
- `.gitignore`, `.npmignore`, `.env.example`: credential, build, and package exclusions.
- `src/config.ts`: environment validation and immutable runtime configuration.
- `src/canvas/errors.ts`: safe internal Canvas error classes and public error messages.
- `src/canvas/client.ts`: GET-only request, pagination, timeout, retry, redirect, and token-redaction boundary.
- `src/canvas/types.ts`: minimal Canvas response shapes consumed by handlers.
- `src/format/html.ts`: Canvas HTML-to-text conversion with useful links retained.
- `src/format/text.ts`: common headings, dates, empty states, and MCP text results.
- `src/domain/assignments.ts`: assignment bucket classification and chronological sorting.
- `src/tools/types.ts`: dependency and handler interfaces shared by all tool modules.
- `src/tools/course-tools.ts`: courses, syllabus, and grades handlers.
- `src/tools/assignment-tools.ts`: assignment list/detail and submission handlers.
- `src/tools/content-tools.ts`: announcements, modules, and pages handlers.
- `src/tools/file-tools.ts`: file listing, safe inline reads, and controlled temporary downloads.
- `src/server.ts`: exact MCP tool registration and handler-to-result error boundary.
- `src/index.ts`: executable stdio startup with stderr-only operational diagnostics.
- `tests/fixtures/*.ts`: fictional Canvas payloads.
- `tests/*.test.ts`: focused configuration, client, domain, handler, server, packaging, and security tests.
- `README.md`, `docs/clients/*.md`: installation and client-specific configuration.
- `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`: public repository governance.
- `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.github/dependabot.yml`: continuous integration, trusted publishing, and dependency updates.

---

### Task 1: Project Foundation and Configuration Boundary

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `bin/mcp-server-canvas-lms.js`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`
- Create: `tsup.config.ts`
- Create: `eslint.config.js`
- Create: `.prettierrc.json`
- Create: `.gitignore`
- Create: `.npmignore`
- Create: `.env.example`
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

**Interfaces:**
- Consumes: process environment values supplied by an MCP host.
- Produces: `loadConfig(env: NodeJS.ProcessEnv): Readonly<CanvasConfig>` where `CanvasConfig` is `{ baseUrl: URL; apiToken: string; timeoutMs: number; maxPages: number }`.

- [ ] **Step 1: Create the package metadata and strict toolchain**

Create `package.json` with the following runtime contract and scripts, then run `npm install` to generate `package-lock.json`:

```json
{
  "name": "mcp-server-canvas-lms",
  "version": "0.1.0",
  "description": "Minimal, student-focused, strictly read-only MCP server for Canvas LMS",
  "type": "module",
  "license": "MIT",
  "bin": { "mcp-server-canvas-lms": "bin/mcp-server-canvas-lms.js" },
  "exports": { ".": "./dist/server.js" },
  "files": ["bin/", "dist/", "README.md", "LICENSE"],
  "engines": { "node": ">=20.19.0" },
  "scripts": {
    "build": "tsup && tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src tests && prettier --check .",
    "format": "prettier --write .",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "prepack": "npm run build && npm test"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.30.0",
    "html-to-text": "^10.0.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@types/html-to-text": "^9.0.4",
    "@types/node": "^20.19.0",
    "@vitest/coverage-v8": "^4.1.10",
    "eslint": "^10.8.1",
    "prettier": "^3.9.6",
    "tsup": "^8.5.1",
    "typescript": "^6.0.3",
    "typescript-eslint": "^8.67.0",
    "vitest": "^4.1.10"
  }
}
```

Configure strict ESM compilation, Node module resolution, declaration output, source maps, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`. Configure tsup to emit `dist/server.js`, `dist/index.js`, and type declarations. Create a two-line executable shim at `bin/mcp-server-canvas-lms.js` that imports `../dist/index.js`.

Use this compiler baseline in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src", "tests", "tsup.config.ts", "eslint.config.js"]
}
```

`tsconfig.build.json` extends it, enables declarations, and includes only `src`. `tsup.config.ts` uses entries `src/server.ts` and `src/index.ts`, ESM format, Node 20 target, source maps, declarations, and a clean output directory. `eslint.config.js` combines `@eslint/js` recommended rules with `typescript-eslint` strict type-checked rules for `src/**/*.ts` and non-type-checked recommended rules for `tests/**/*.ts`.

- [ ] **Step 2: Write failing configuration tests**

```ts
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('normalizes a valid Canvas origin', () => {
    const config = loadConfig({
      CANVAS_BASE_URL: 'https://canvas.example.edu/',
      CANVAS_API_TOKEN: 'secret-value',
    });
    expect(config.baseUrl.href).toBe('https://canvas.example.edu/');
    expect(config.apiToken).toBe('secret-value');
    expect(config.timeoutMs).toBe(15_000);
    expect(config.maxPages).toBe(20);
  });

  it.each([
    '',
    'canvas.example.edu',
    'http://canvas.example.edu',
    'https://user:pass@canvas.example.edu',
    'https://canvas.example.edu/api/v1',
  ])('rejects unsafe base URL %s', (baseUrl) => {
    expect(() => loadConfig({
      CANVAS_BASE_URL: baseUrl,
      CANVAS_API_TOKEN: 'secret-value',
    })).toThrow(/CANVAS_BASE_URL/);
  });

  it('does not expose the token in errors', () => {
    const token = 'never-print-this-token';
    try {
      loadConfig({ CANVAS_BASE_URL: 'invalid', CANVAS_API_TOKEN: token });
    } catch (error) {
      expect(String(error)).not.toContain(token);
    }
  });
});
```

- [ ] **Step 3: Run the focused test and confirm failure**

Run: `npm test -- tests/config.test.ts`

Expected: FAIL because `src/config.ts` does not exist.

- [ ] **Step 4: Implement minimal immutable configuration validation**

```ts
export interface CanvasConfig {
  readonly baseUrl: URL;
  readonly apiToken: string;
  readonly timeoutMs: number;
  readonly maxPages: number;
}

export function loadConfig(env: NodeJS.ProcessEnv): Readonly<CanvasConfig> {
  const rawUrl = env.CANVAS_BASE_URL?.trim();
  const apiToken = env.CANVAS_API_TOKEN?.trim();
  if (!rawUrl) throw new Error('CANVAS_BASE_URL is required');
  if (!apiToken) throw new Error('CANVAS_API_TOKEN is required');

  let baseUrl: URL;
  try { baseUrl = new URL(rawUrl); }
  catch { throw new Error('CANVAS_BASE_URL must be an absolute URL'); }

  const localhost = baseUrl.hostname === 'localhost' || baseUrl.hostname === '127.0.0.1';
  if (baseUrl.protocol !== 'https:' && !(localhost && baseUrl.protocol === 'http:')) {
    throw new Error('CANVAS_BASE_URL must use HTTPS');
  }
  if (baseUrl.username || baseUrl.password) {
    throw new Error('CANVAS_BASE_URL must not contain credentials');
  }
  if (baseUrl.pathname !== '/' && baseUrl.pathname !== '') {
    throw new Error('CANVAS_BASE_URL must be the Canvas origin without /api/v1');
  }
  baseUrl.pathname = '/';
  return Object.freeze({ baseUrl, apiToken, timeoutMs: 15_000, maxPages: 20 });
}
```

- [ ] **Step 5: Add credential-safe ignore and example files**

`.gitignore` must exclude `.env`, `.env.*` except `.env.example`, `node_modules/`, `dist/`, `coverage/`, `*.tgz`, `.tmp-*`, `*.tmp`, and `canvas-downloads/`. `.env.example` must contain only `CANVAS_BASE_URL=https://canvas.example.edu` and `CANVAS_API_TOKEN=replace-with-your-personal-token`.

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npm run lint && npm test -- tests/config.test.ts`

Expected: all commands exit successfully.

```bash
git add package.json package-lock.json tsconfig.json tsconfig.build.json tsup.config.ts eslint.config.js .prettierrc.json .gitignore .npmignore .env.example bin src/config.ts tests/config.test.ts
git commit -m "chore: scaffold Canvas MCP package"
```

### Task 2: GET-Only Canvas HTTP Client

**Files:**
- Create: `src/canvas/errors.ts`
- Create: `src/canvas/client.ts`
- Create: `tests/client.test.ts`

**Interfaces:**
- Consumes: `CanvasConfig` from Task 1 and an optional injected `fetch` implementation.
- Produces: `CanvasClient.get<T>(path: CanvasPath, query?: CanvasQuery): Promise<T>` and `CanvasClient.getAll<T>(path: CanvasPath, query?: CanvasQuery): Promise<T[]>`.

- [ ] **Step 1: Write failing request, pagination, and redaction tests**

Create tests that inject a `vi.fn<typeof fetch>()` and assert:

```ts
expect(fetchMock).toHaveBeenCalledWith(
  'https://canvas.example.edu/api/v1/courses?enrollment_state=active',
  expect.objectContaining({
    method: 'GET',
    redirect: 'manual',
    headers: expect.objectContaining({ Authorization: 'Bearer secret-value' }),
  }),
);
```

Add cases where a two-page `Link` header is followed, a next link on `evil.example` is rejected, page 21 is rejected, `401/403/404/429` responses map to safe messages, `Retry-After: 1` permits one retry, an aborted request reports a timeout, and no thrown string contains `secret-value`.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npm test -- tests/client.test.ts`

Expected: FAIL because the client and error classes do not exist.

- [ ] **Step 3: Implement explicit safe error types**

```ts
export type CanvasErrorCode =
  | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'RATE_LIMITED'
  | 'TIMEOUT' | 'BAD_RESPONSE' | 'NETWORK' | 'UNSAFE_URL';

export class CanvasError extends Error {
  constructor(public readonly code: CanvasErrorCode, message: string) {
    super(message);
    this.name = 'CanvasError';
  }
}
```

Map status codes to fixed messages. For unknown responses, include only the status number and configured hostname; do not include response bodies, headers, or request options.

- [ ] **Step 4: Implement the only public network operation**

```ts
export type CanvasPath = `/${string}`;
export type CanvasQuery = Readonly<Record<string, string | number | boolean | readonly string[] | undefined>>;

export class CanvasClient {
  constructor(
    private readonly config: Readonly<CanvasConfig>,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  async get<T>(path: CanvasPath, query: CanvasQuery = {}): Promise<T> {
    const url = this.buildApiUrl(path, query);
    return this.fetchJson<T>(url);
  }

  async getAll<T>(path: CanvasPath, query: CanvasQuery = {}): Promise<T[]> {
    const values: T[] = [];
    let next: URL | undefined = this.buildApiUrl(path, query);
    for (let page = 1; next && page <= this.config.maxPages; page += 1) {
      const response = await this.fetchResponse(next);
      const body = await response.json() as unknown;
      if (!Array.isArray(body)) throw new CanvasError('BAD_RESPONSE', 'Canvas returned an invalid list response');
      values.push(...body as T[]);
      next = this.readSafeNextLink(response.headers.get('link'));
    }
    if (next) throw new CanvasError('BAD_RESPONSE', `Canvas pagination exceeded ${this.config.maxPages} pages`);
    return values;
  }
}
```

`fetchResponse` must use `AbortSignal.timeout(config.timeoutMs)`, `method: 'GET'`, `redirect: 'manual'`, `Accept: application/json`, and `Authorization: Bearer <token>`. It may retry only `429` and transient `502/503/504` responses, at most twice, honoring a numeric `Retry-After` capped at five seconds. Manual redirects are accepted only when the `Location` URL is HTTPS and has the configured origin; otherwise throw `UNSAFE_URL`.

- [ ] **Step 5: Add a static GET-only guard test**

Read `src/canvas/client.ts` as text and assert that it contains `method: 'GET'`, has no public method named `request`, and contains none of the string literals `POST`, `PUT`, `PATCH`, or `DELETE`.

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npm test -- tests/client.test.ts`

Expected: PASS, including same-origin and token-redaction cases.

```bash
git add src/canvas tests/client.test.ts
git commit -m "feat: add GET-only Canvas client"
```

### Task 3: Canvas Types, HTML Formatting, and Assignment Buckets

**Files:**
- Create: `src/canvas/types.ts`
- Create: `src/format/html.ts`
- Create: `src/format/text.ts`
- Create: `src/domain/assignments.ts`
- Create: `tests/format.test.ts`
- Create: `tests/assignments.test.ts`

**Interfaces:**
- Consumes: raw Canvas response objects and ISO timestamps.
- Produces: minimal Canvas interfaces; `htmlToReadableText(html: string): string`; `textResult(text: string): CallToolResult`; `classifyAssignment(assignment, now): AssignmentBucket`; `sortAssignments(assignments): CanvasAssignment[]`.

- [ ] **Step 1: Write failing formatter tests**

```ts
expect(htmlToReadableText('<p>Read <a href="https://example.edu/week1">Week 1</a>.</p>'))
  .toBe('Read Week 1 [https://example.edu/week1].');
expect(htmlToReadableText('<script>steal()</script><p>Hello&nbsp;world</p>'))
  .toBe('Hello world');
expect(formatTimestamp('2026-08-21T13:59:59Z', 'Australia/Sydney'))
  .toContain('21 August 2026');
expect(formatTimestamp('2026-08-21T13:59:59Z', 'Australia/Sydney'))
  .toContain('Australia/Sydney');
```

Use `html-to-text` with scripts/styles skipped, link URLs retained, whitespace collapsed, and output capped at 100,000 characters with an explicit truncation note.

- [ ] **Step 2: Write failing assignment bucket tests**

Use a fixed `now = new Date('2026-08-14T00:00:00Z')` and cover future unsubmitted, future graded, past unsubmitted, past submitted, past graded, excused, non-submittable, and missing due-date assignments. Assert the specification's exact `upcoming`, `overdue`, `past`, and `all` rules and chronological ordering with undated items last.

- [ ] **Step 3: Run both focused tests and confirm failure**

Run: `npm test -- tests/format.test.ts tests/assignments.test.ts`

Expected: FAIL because formatting and domain modules do not exist.

- [ ] **Step 4: Define only the Canvas fields handlers use**

Create interfaces for `CanvasCourse`, `CanvasEnrollment`, `CanvasAssignment`, `CanvasSubmission`, `CanvasAnnouncement`, `CanvasModule`, `CanvasModuleItem`, `CanvasPage`, `CanvasFile`, `CanvasRubricCriterion`, and `CanvasSubmissionComment`. Use optional properties for fields Canvas may omit and `unknown` for unconsumed nested values; do not reproduce the complete Canvas API schema.

- [ ] **Step 5: Implement formatting and bucket logic**

```ts
export type AssignmentBucket = 'upcoming' | 'overdue' | 'past' | 'all';

export function isInBucket(a: CanvasAssignment, bucket: AssignmentBucket, now: Date): boolean {
  if (bucket === 'all') return true;
  if (!a.due_at) return false;
  const past = new Date(a.due_at).getTime() < now.getTime();
  const state = a.submission?.workflow_state;
  const complete = a.submission?.excused === true || state === 'submitted' || state === 'graded';
  if (bucket === 'past') return past;
  if (bucket === 'upcoming') return !past && !complete;
  const requiresSubmission = !a.submission_types?.includes('none');
  return past && requiresSubmission && !complete;
}
```

`formatTimestamp` must accept an explicit IANA timezone. Use `Intl.DateTimeFormat` and append the timezone name to every rendered timestamp. The server will pass `Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'`.

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npm test -- tests/format.test.ts tests/assignments.test.ts`

Expected: PASS.

```bash
git add src/canvas/types.ts src/format src/domain tests/format.test.ts tests/assignments.test.ts
git commit -m "feat: add Canvas response formatting"
```

### Task 4: Course, Assignment, Grade, and Submission Handlers

**Files:**
- Create: `src/tools/types.ts`
- Create: `src/tools/course-tools.ts`
- Create: `src/tools/assignment-tools.ts`
- Create: `tests/fixtures/academic.ts`
- Create: `tests/course-tools.test.ts`
- Create: `tests/assignment-tools.test.ts`

**Interfaces:**
- Consumes: `CanvasClient`, formatting functions, bucket logic, and explicit input interfaces.
- Produces: `createCourseHandlers(client, timezone)` and `createAssignmentHandlers(client, timezone)`, together implementing six tool handlers.

- [ ] **Step 1: Create fictional fixtures and failing course-handler tests**

Fixtures must use `canvas.example.edu`, fictional course names, user ID `42`, and tokens absent from serialized fixture text. Assert these endpoint contracts:

| Handler | Canvas request |
|---|---|
| `listCourses` | `GET /api/v1/courses?enrollment_state=active&include[]=term&include[]=total_scores&per_page=100` |
| `getSyllabus` | `GET /api/v1/courses/:courseId?include[]=syllabus_body` |
| `getGrades` totals | all courses use the active-course endpoint; one course uses `GET /api/v1/courses/:courseId?include[]=total_scores` |
| `getGrades` breakdown | `GET /api/v1/courses/:courseId/assignments?include[]=submission&per_page=100` |

Assert stable headings, course IDs, current score when Canvas exposes it, a clear hidden-grade message when it does not, HTML-free syllabus text, and `No matching Canvas courses found.` for an empty list.

- [ ] **Step 2: Write failing assignment-handler tests**

Assert these endpoint contracts:

| Handler | Canvas request |
|---|---|
| `listAssignments` one course | `GET /api/v1/courses/:courseId/assignments?include[]=submission&order_by=due_at&per_page=100` |
| `listAssignments` all courses | list active courses, then call the assignment endpoint serially for each course |
| `getAssignment` | `GET /api/v1/courses/:courseId/assignments/:assignmentId?include[]=submission` |
| `getSubmission` | `GET /api/v1/courses/:courseId/assignments/:assignmentId/submissions/self?include[]=submission_comments&include[]=rubric_assessment` |

Assert bucket filtering, global chronological sorting, course names, due timestamps with timezone, submission state, points, grade, comments, rubric ratings, and Canvas web links. Validate positive integer IDs, bucket enum values, and limits from 1 through 100.

- [ ] **Step 3: Run focused tests and confirm failure**

Run: `npm test -- tests/course-tools.test.ts tests/assignment-tools.test.ts`

Expected: FAIL because the handler factories do not exist.

- [ ] **Step 4: Implement the shared handler contract**

```ts
export type TextResult = { content: [{ type: 'text'; text: string }]; isError?: boolean };
export type Handler<T> = (input: T) => Promise<TextResult>;
export interface ToolDependencies { client: CanvasClient; timezone: string; now: () => Date; }

export function textResult(text: string): TextResult {
  return { content: [{ type: 'text', text }] };
}
```

Handler factories accept dependencies rather than reading environment state. Use `now: () => new Date()` in production and a fixed clock in tests.

- [ ] **Step 5: Implement the six handlers**

```ts
export interface ListAssignmentsInput {
  course_id?: number;
  bucket?: AssignmentBucket;
  limit?: number;
}

export interface CourseHandlers {
  listCourses: Handler<Record<string, never>>;
  getSyllabus: Handler<{ course_id: number }>;
  getGrades: Handler<{ course_id?: number }>;
}

export interface AssignmentHandlers {
  listAssignments: Handler<ListAssignmentsInput>;
  getAssignment: Handler<{ course_id: number; assignment_id: number }>;
  getSubmission: Handler<{ course_id: number; assignment_id: number }>;
}
```

Call only the fixed paths in the tables above. For all-course assignment reads, catch a per-course `403` and include `Skipped <course>: access denied`; propagate authentication, rate-limit, unsafe URL, and network errors. Apply the final global limit only after combining and sorting all courses.

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npm test -- tests/course-tools.test.ts tests/assignment-tools.test.ts`

Expected: PASS.

```bash
git add src/tools tests/fixtures/academic.ts tests/course-tools.test.ts tests/assignment-tools.test.ts
git commit -m "feat: add academic Canvas handlers"
```

### Task 5: Announcements, Modules, and Pages Handlers

**Files:**
- Create: `src/tools/content-tools.ts`
- Create: `tests/fixtures/content.ts`
- Create: `tests/content-tools.test.ts`

**Interfaces:**
- Consumes: `ToolDependencies`, Canvas content types, and HTML/text formatters.
- Produces: `createContentHandlers(dependencies)` implementing three handlers.

- [ ] **Step 1: Write failing content-handler tests**

Assert the exact requests and behavior:

| Handler | Canvas request and rule |
|---|---|
| `listAnnouncements` one course | `GET /api/v1/announcements?context_codes[]=course_:courseId&start_date=:ISO-date&end_date=:ISO-date&per_page=100` |
| `listAnnouncements` all courses | list active courses, then send one announcements request containing all `context_codes[]` values in batches of 20 |
| `listModules` | `GET /api/v1/courses/:courseId/modules?include[]=items&include[]=content_details&per_page=100`; when a module omits `items`, also call `GET /api/v1/courses/:courseId/modules/:moduleId/items?include[]=content_details&per_page=100` |
| `getPage` | `GET /api/v1/courses/:courseId/pages/:encodedPageSlug` |

Test the default announcement window of 30 days, `since_days` validation from 1 through 365, batching 21 courses into two requests, module item fallback, locked item details, URL encoding of a page slug, HTML cleaning, and empty states.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npm test -- tests/content-tools.test.ts`

Expected: FAIL because `createContentHandlers` does not exist.

- [ ] **Step 3: Implement the content-handler contract and fixed paths**

```ts
export interface ContentHandlers {
  listAnnouncements: Handler<{ course_id?: number; since_days?: number }>;
  listModules: Handler<{ course_id: number }>;
  getPage: Handler<{ course_id: number; page_url: string }>;
}
```

Reject page slugs that are empty, exceed 255 characters, or contain `/`, `?`, or `#`; pass the accepted slug through `encodeURIComponent`. Sort announcements newest first and modules/items by Canvas position. Display item type, title, completion requirement, lock status, and Canvas HTML URL when present.

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck && npm test -- tests/content-tools.test.ts`

Expected: PASS.

```bash
git add src/tools/content-tools.ts tests/fixtures/content.ts tests/content-tools.test.ts
git commit -m "feat: add Canvas content handlers"
```

### Task 6: Safe Course File Listing and Reading

**Files:**
- Create: `src/tools/file-tools.ts`
- Create: `src/canvas/download.ts`
- Create: `tests/fixtures/files.ts`
- Create: `tests/file-tools.test.ts`

**Interfaces:**
- Consumes: `CanvasClient`, injected file-download fetch, and injected temporary-directory factory.
- Produces: `createFileHandlers(dependencies)` with `listFiles` and `readFile`; `downloadCanvasFile(file, options): Promise<InlineFile | DownloadedFile>`.

- [ ] **Step 1: Write failing file tests**

Assert `listFiles` calls `GET /api/v1/courses/:courseId/files?search_term=:search&sort=name&order=asc&per_page=100`. Assert `readFile` first paginates `GET /api/v1/courses/:courseId/files?per_page=100`, rejects a file ID absent from that course-scoped list, then calls `GET /api/v1/files/:fileId` for current metadata and applies these rules:

- Inline only UTF-8 text, Markdown, JSON, CSV, XML, and HTML files at or below 256 KiB.
- Convert inline HTML through `htmlToReadableText`; return other supported text unchanged with a 100,000-character cap.
- Download other files into a newly created directory under `os.tmpdir()` named `mcp-server-canvas-lms-*`.
- Sanitize filenames to ASCII letters, digits, `.`, `_`, and `-`; fall back to `canvas-file-<id>`.
- Reject an initial download URL unless it is HTTPS and matches the configured Canvas origin.
- Follow at most three manual redirects. The Canvas origin may redirect once to an external HTTPS download host; reject IP-literal, localhost, `.local`, loopback, link-local, and private-network targets. After leaving Canvas, every remaining redirect must keep the same external hostname.
- Never forward the Canvas `Authorization` header to an external download host.
- Cap downloads at 25 MiB using both `Content-Length` and streamed byte count.
- Delete a partial file after any error.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npm test -- tests/file-tools.test.ts`

Expected: FAIL because file handlers and download policy do not exist.

- [ ] **Step 3: Implement explicit file result types and lifecycle**

```ts
export type InlineFile = { kind: 'inline'; name: string; mimeType: string; text: string };
export type DownloadedFile = { kind: 'downloaded'; name: string; mimeType: string; path: string; size: number };

export interface FileHandlers {
  listFiles: Handler<{ course_id: number; search?: string }>;
  readFile: Handler<{ course_id: number; file_id: number }>;
}
```

Return downloaded file paths only for the current tool call. Register `process.once('exit', cleanup)` for every created temporary directory and also expose `cleanupDownloads()` so tests and normal server shutdown can remove them. Never write inside the repository or home directory.

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck && npm test -- tests/file-tools.test.ts`

Expected: PASS, including cross-origin credential stripping, size limits, and partial-file cleanup.

```bash
git add src/canvas/download.ts src/tools/file-tools.ts tests/fixtures/files.ts tests/file-tools.test.ts
git commit -m "feat: add safe Canvas file reading"
```

### Task 7: Exact MCP Registration, Error Boundary, and CLI

**Files:**
- Create: `src/server.ts`
- Create: `src/index.ts`
- Create: `bin/mcp-server-canvas-lms.js`
- Create: `tests/server.test.ts`
- Create: `tests/security.test.ts`

**Interfaces:**
- Consumes: `CanvasClient` and all four handler factories.
- Produces: `createCanvasServer(config, options?): McpServer`, the stdio executable, and exactly eleven discoverable MCP tools.

- [ ] **Step 1: Write failing inventory and schema tests**

Connect an in-memory MCP client to the server and assert the sorted tool names equal exactly:

```ts
[
  'canvas_get_assignment',
  'canvas_get_grades',
  'canvas_get_page',
  'canvas_get_submission',
  'canvas_get_syllabus',
  'canvas_list_announcements',
  'canvas_list_assignments',
  'canvas_list_courses',
  'canvas_list_files',
  'canvas_list_modules',
  'canvas_read_file',
]
```

For every integer ID schema, assert zero, negative numbers, decimals, and strings fail validation. Assert the assignment bucket enum and all numeric limits. Assert every tool description starts with `Read-only Canvas LMS access.`

- [ ] **Step 2: Write failing end-to-end security tests**

Execute all eleven tools against a routing fake fetch and assert every captured request uses `GET`. Return representative `401`, `403`, `404`, `429`, timeout, and malformed JSON failures and assert tool results set `isError: true`, contain a useful fixed message, and contain neither the token nor raw authorization headers.

- [ ] **Step 3: Run the focused tests and confirm failure**

Run: `npm test -- tests/server.test.ts tests/security.test.ts`

Expected: FAIL because the MCP server and CLI do not exist.

- [ ] **Step 4: Register the exact schemas and handlers**

Use `McpServer.registerTool` for each approved name. Define reusable schemas:

```ts
const positiveId = z.number().int().positive();
const optionalLimit = z.number().int().min(1).max(100).optional();
const readOnlyPrefix = 'Read-only Canvas LMS access. All requests use Canvas GET endpoints; this server cannot modify Canvas.';
```

Wrap each handler in one `safeTool` function. `CanvasError` values map to fixed public messages; Zod failures return concise invalid-input messages; unexpected failures return `Canvas request failed unexpectedly.` and write only the error class plus configured Canvas hostname to stderr.

- [ ] **Step 5: Implement stdio startup and clean shutdown**

```ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { createCanvasServer } from './server.js';
import { cleanupDownloads } from './canvas/download.js';

const config = loadConfig(process.env);
const server = createCanvasServer(config);
await server.connect(new StdioServerTransport());

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await server.close();
    await cleanupDownloads();
    process.exit(0);
  });
}
```

The executable must never write normal output to stdout because stdout carries MCP protocol messages. Startup failures go to stderr and set `process.exitCode = 1` without printing environment values.

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npm test -- tests/server.test.ts tests/security.test.ts`

Expected: PASS with exactly eleven tools and GET-only traffic.

```bash
git add src/server.ts src/index.ts bin tests/server.test.ts tests/security.test.ts
git commit -m "feat: expose read-only Canvas MCP server"
```

### Task 8: Package Smoke Test and User Documentation

**Files:**
- Create: `tests/package.test.ts`
- Create: `README.md`
- Create: `docs/clients/codex.md`
- Create: `docs/clients/claude-desktop.md`
- Create: `docs/clients/cursor.md`
- Create: `docs/clients/vscode.md`
- Create: `docs/clients/generic.md`
- Create: `LICENSE`
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`

**Interfaces:**
- Consumes: the built npm tarball and public CLI.
- Produces: a clean-install path a new user can follow without repository knowledge.

- [ ] **Step 1: Write a failing package-content and startup test**

Run `npm pack --json --ignore-scripts`, parse the emitted file list, and assert it contains only `bin/`, `dist/`, `README.md`, `LICENSE`, and `package.json`. Assert it excludes `src/`, `tests/`, `.env`, `.github/`, `docs/superpowers/`, and local downloads. Install the tarball into `mkdtemp(join(tmpdir(), 'canvas-mcp-smoke-'))`, start the executable with fictional configuration, complete an MCP initialize/list-tools exchange over stdio, assert exactly eleven tools, then terminate and remove the directory.

- [ ] **Step 2: Run the package test and confirm failure**

Run: `npm run build && npm test -- tests/package.test.ts`

Expected: FAIL because public documentation and final package metadata are incomplete.

- [ ] **Step 3: Write the quick-start README**

Lead with the exact value proposition: `A minimal, student-focused, strictly read-only MCP server for Canvas LMS.` Include:

1. Node.js 20.19+ prerequisite.
2. Canvas path `Account -> Settings -> Approved Integrations -> + New Access Token`.
3. Warning that a token has the user's Canvas permissions and must never be committed or shared.
4. Base URL example `https://canvas.example.edu`, explicitly excluding `/api/v1`.
5. Primary command `npx -y mcp-server-canvas-lms`.
6. A first connection check: `List my active Canvas courses.`
7. The eleven-tool inventory and read-only guarantee.
8. Troubleshooting for missing Node, disabled personal tokens, invalid/expired tokens, base URL mistakes, client restart, `403`, `429`, and institutional policy restrictions.
9. Repository, npm, issue, security, and license links.

- [ ] **Step 4: Add exact client configuration examples**

Every JSON-based client example must use this shared command and environment shape:

```json
{
  "command": "npx",
  "args": ["-y", "mcp-server-canvas-lms"],
  "env": {
    "CANVAS_BASE_URL": "https://canvas.example.edu",
    "CANVAS_API_TOKEN": "replace-with-your-personal-token"
  }
}
```

Use each client's documented surrounding configuration format and file location. Codex documentation must show the current Codex MCP configuration syntax verified from official local documentation or the installed Codex CLI help at implementation time. Do not guess client paths.

- [ ] **Step 5: Add governance files**

Use the canonical MIT license text with `Copyright (c) 2026 Contributors`. `SECURITY.md` must direct reporters to GitHub private vulnerability reporting and explicitly forbid filing secrets in public issues. `CONTRIBUTING.md` must require fictional fixtures, no live tokens, GET-only endpoints, focused tests, and `npm run lint && npm run typecheck && npm test` before a pull request.

- [ ] **Step 6: Verify and commit**

Run: `npm run build && npm test -- tests/package.test.ts && npm pack --dry-run`

Expected: clean install succeeds; packed files match the allowlist; no credential or development artifact is included.

```bash
git add README.md docs/clients LICENSE CONTRIBUTING.md SECURITY.md tests/package.test.ts package.json
git commit -m "docs: add installation and package guidance"
```

### Task 9: CI, Trusted npm Publishing, and Release Readiness

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`
- Create: `.github/dependabot.yml`
- Create: `tests/release.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: GitHub pull requests, version tags matching `v*.*.*`, npm trusted publishing configuration, and the complete test suite.
- Produces: reproducible CI and provenance-enabled npm releases.

- [ ] **Step 1: Write failing release-policy tests**

Parse workflow YAML as text and assert:

- CI triggers for pull requests and pushes to `main`.
- CI runs on Node `20.19.x`, `22.x`, and `24.x`.
- CI runs `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm pack --dry-run`.
- Release triggers only on `v*.*.*` tags.
- The release job has `contents: read` and `id-token: write`, runs the complete verification suite, and executes `npm publish --provenance --access public`.
- Every `uses:` reference contains a 40-character commit SHA followed by a version comment.
- No workflow contains `NPM_TOKEN`, a token literal, `pull_request_target`, or a mutable action tag.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npm test -- tests/release.test.ts`

Expected: FAIL because the workflows do not exist.

- [ ] **Step 3: Add CI and trusted-publishing workflows**

Create one CI job with a Node-version matrix and npm cache. Create one release job that checks the tag version equals `package.json` version before publishing:

```bash
node -e "const p=require('./package.json'); const tag=process.env.GITHUB_REF_NAME; if (tag !== 'v'+p.version) process.exit(1)"
```

Resolve the current immutable SHAs for `actions/checkout`, `actions/setup-node`, and any release action from their official repositories during implementation. Set the npm registry URL through `actions/setup-node`, and configure the npm package's trusted publisher for this GitHub repository before the first real tag.

- [ ] **Step 4: Add weekly dependency updates**

Configure Dependabot for the npm and GitHub Actions ecosystems on a weekly schedule, with no automatic merge permissions.

- [ ] **Step 5: Run the complete local release gate**

Run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm pack --dry-run
npm audit --omit=dev
git grep -nE 'CANVAS_API_TOKEN=.{12,}|Bearer [A-Za-z0-9_-]{12,}' -- . ':!package-lock.json'
```

Expected: all quality commands pass, the production dependency audit reports no known vulnerability, and the credential-pattern scan prints no matches.

- [ ] **Step 6: Commit release automation**

```bash
git add .github package.json tests/release.test.ts
git commit -m "ci: add verified npm release workflow"
```

- [ ] **Step 7: Perform manual pre-release checks without publishing**

Install the packed tarball in a clean directory and connect it to Codex plus one other standard MCP client using fictional or dedicated test-tenant credentials. Verify tool discovery, course listing, the nearest-unsubmitted-deadline workflow, a permission error, and clean shutdown. Record only pass/fail results and client versions in the GitHub release draft; do not record course data or tokens.

- [ ] **Step 8: Hand off owner-only publishing steps**

Before any public write, obtain the GitHub owner/repository name and the npm account or organization. The owner then creates the public GitHub repository, enables private vulnerability reporting and branch protection, configures npm trusted publishing for `.github/workflows/release.yml`, and confirms the npm package name is still available. Only after those checks should the owner push `main`, create tag `v0.1.0`, and approve the first trusted publish.

## Final Verification Checklist

- [ ] Read the approved spec again and confirm every goal, non-goal, tool, safety rule, data-handling rule, installation target, test requirement, and release control is represented above.
- [ ] Run the writing-plans forbidden-phrase scan and require no matches.
- [ ] Run `npm run lint && npm run typecheck && npm test && npm run build && npm pack --dry-run` from a clean checkout.
- [ ] Inspect the packed tarball and confirm no token, `.env`, test fixture, local file, or repository-only document is included.
- [ ] Confirm the MCP client lists exactly eleven tools and every integration request captured by tests uses `GET`.
- [ ] Confirm repository creation and npm publishing remain owner-approved external actions rather than automatic local implementation steps.
