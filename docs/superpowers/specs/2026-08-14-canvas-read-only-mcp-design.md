# Read-Only Canvas LMS MCP Server Design

Date: 2026-08-14

## Summary

Build and publish `mcp-server-canvas-lms`, a minimal, student-focused Model Context Protocol server for Canvas LMS. The package will expose exactly eleven read-only tools, run locally over standard input/output, and work with Codex and other standards-compatible MCP clients.

The defining guarantee is structural read-only behavior: the Canvas client will support HTTP `GET` requests only. The package will contain no Canvas mutation methods, so it cannot submit assignments, send messages, change grades, edit course content, or perform administrative actions even when configured with a highly privileged token.

The project will be public, MIT-licensed, hosted on GitHub, and distributed through npm as `mcp-server-canvas-lms`.

## Goals

- Let a student ask about courses, deadlines, grades, feedback, announcements, modules, pages, syllabuses, and files.
- Provide an installation path based on `npx -y mcp-server-canvas-lms`.
- Support Codex, Claude Desktop, Cursor, VS Code, and generic stdio MCP clients through documented configuration examples.
- Keep credentials outside the repository, package, logs, and tool responses.
- Keep the server small enough for users and maintainers to audit.
- Publish releases through a tested, provenance-enabled GitHub Actions workflow.

## Non-goals for Version 1

- Submitting assignments or quizzes.
- Posting discussions, announcements, or messages.
- Editing grades, enrollments, course content, or account settings.
- Teacher or administrator automation.
- Streamable HTTP, remote hosting, Docker, Kubernetes, or a web interface.
- Persisting Canvas data or credentials.
- Matching the feature breadth of existing full-control Canvas MCP servers.

## Intended Users

The primary user is a Canvas student who wants an AI assistant to read academic information and answer questions such as:

- What is my nearest unsubmitted deadline?
- Which assignments are overdue?
- What feedback did my instructor leave?
- What is my current course grade?
- What files or modules are available for this course?

Other Canvas roles may use the package, but version 1 will not add role-specific tools or privileged workflows.

## Package and Runtime

- Package name: `mcp-server-canvas-lms`
- Initial version: `0.1.0`
- License: MIT
- Implementation: TypeScript on Node.js
- Protocol library: official Model Context Protocol TypeScript SDK
- Transport: stdio only
- Executable: `mcp-server-canvas-lms`
- Primary invocation: `npx -y mcp-server-canvas-lms`

The exact minimum supported Node.js version will be selected during implementation based on the official MCP SDK's supported runtime and then enforced consistently in `package.json`, CI, and documentation.

## Configuration

The server will require two environment variables:

- `CANVAS_BASE_URL`: the institution's HTTPS Canvas origin, without `/api/v1`.
- `CANVAS_API_TOKEN`: the user's Canvas personal access token.

Startup validation will reject missing values, malformed URLs, non-HTTPS remote URLs, URLs containing credentials, and base URLs that include an API path. Localhost HTTP may be allowed only for development and tests.

The token will never be written to disk, included in logs, echoed in errors, or returned through MCP. Documentation will instruct users to generate a dedicated token with an expiry date when their institution supports it and to revoke it if exposed.

## Architecture

The package will have four focused layers:

1. **Configuration** validates environment variables and creates an immutable runtime configuration.
2. **Canvas client** performs authenticated, timeout-bounded `GET` requests, follows Canvas pagination safely, and maps Canvas/network failures into internal error types.
3. **Tool handlers** validate MCP inputs, call the Canvas client, and convert Canvas responses into concise, stable text suitable for an AI client.
4. **MCP entry point** registers exactly eleven tools and connects the server to stdio.

The request flow is:

`MCP client -> validated tool input -> GET-only Canvas client -> Canvas API -> cleaned MCP response`

No layer will contain a generic arbitrary-method request function. Pagination will follow only trusted Canvas `Link` headers that resolve to the configured Canvas origin.

## Version 1 Tool Surface

The public tool names will retain the `canvas_` prefix to remain explicit when installed alongside other MCP servers.

1. `canvas_list_courses`
   - Lists active Canvas courses with term information and available current scores.
2. `canvas_list_assignments`
   - Lists assignments across active courses or one course.
   - Supports `upcoming`, `overdue`, `past`, and `all` buckets plus an optional result limit.
3. `canvas_get_assignment`
   - Reads one assignment's requirements, description, rubric, and the current user's submission summary.
4. `canvas_get_grades`
   - Reads course totals or a per-assignment grade breakdown for one course.
5. `canvas_get_submission`
   - Reads the current user's submission status, score, grade, instructor comments, and rubric assessment.
6. `canvas_get_syllabus`
   - Reads a course syllabus as cleaned text.
7. `canvas_list_announcements`
   - Lists recent announcements for one course or all active courses.
8. `canvas_list_modules`
   - Lists course modules and their items.
9. `canvas_get_page`
   - Reads one course page using its Canvas page URL slug.
10. `canvas_list_files`
    - Lists course files, with an optional search term.
11. `canvas_read_file`
    - Reads a small supported text file inline or downloads a larger or binary file to a controlled local cache location supplied by the MCP host environment.

Course-scoped tools require a Canvas course ID. The documentation and tool descriptions will guide clients to call `canvas_list_courses` first when an ID is unknown.

## Assignment Buckets and Deadline Rules

Assignment classification will be based on the Canvas due date and current submission state:

- `upcoming`: due in the future and not already graded or excused.
- `overdue`: due in the past, requires submission, and is not submitted, graded, or excused.
- `past`: due in the past regardless of submission state.
- `all`: every assignment returned by the accessible active courses, including assignments without a due date at the end.

Results with due dates will be sorted chronologically. Assignments without due dates will follow dated assignments. Responses will preserve Canvas timestamps and also render them in the local timezone supplied by the runtime; if none is available, the server will state the timezone explicitly rather than silently guessing.

## Read-Only Security Boundary

The read-only claim will be enforced through several independent controls:

- The Canvas client exposes only a `get` operation.
- Every Canvas endpoint is defined as a fixed route template; tools cannot supply arbitrary URLs.
- Pagination URLs must use HTTPS and match the configured Canvas origin.
- Redirects to a different origin are rejected for API calls.
- Tool input schemas accept identifiers and documented filters, not raw request paths.
- A source-level test fails if mutation verbs or generic request escape hatches are introduced into the Canvas client.
- Integration tests verify that all registered tools result only in mocked `GET` calls.

File downloads are also read-only from Canvas. Download URLs will be accepted only when they originate from the configured Canvas host or an explicitly validated Canvas-provided redirect chain. The implementation plan must define the exact temporary-file lifecycle before file download support is considered complete.

## Data Handling

- The server will not maintain a database or long-lived cache.
- Normal API responses remain in memory only for the duration of a tool call.
- The package will not add analytics or telemetry in version 1.
- Tool responses will exclude authentication headers and unnecessary personal profile fields.
- Canvas-authored HTML will be sanitized into readable text while preserving useful links.
- Downloaded files will use sanitized filenames and a controlled, non-repository temporary location.

## Error Handling

Errors will be concise and actionable while avoiding credential or raw-header disclosure:

- Missing or invalid configuration: explain the variable and expected form.
- `401`: token is invalid, expired, or revoked.
- `403`: the token lacks access to the requested Canvas resource.
- `404`: the course, assignment, page, submission, or file was not found or is not visible.
- `429`: Canvas rate limit reached; include safe retry guidance and honor `Retry-After` when present.
- Network timeout or unavailable Canvas instance: identify the host and suggest retrying without exposing request internals.
- Invalid Canvas response: return a stable server error and no unbounded raw HTML.

Requests will have a finite timeout. Pagination and retry counts will be bounded to prevent runaway tool calls.

## Installation Experience

The README will lead with a short path:

1. Generate a Canvas personal access token from Canvas Account Settings.
2. Identify the institution's Canvas origin.
3. Add one MCP configuration block containing the `npx` command and two environment variables.
4. Restart or reload the MCP client.
5. Ask the client to list Canvas courses as a connection check.

Separate copy-and-paste examples will be maintained for:

- Codex
- Claude Desktop
- Cursor
- VS Code
- Generic JSON-based stdio MCP clients

Examples will contain obvious placeholders and will never encourage committing tokens to source control. The README will include troubleshooting for missing Node.js, invalid tokens, malformed Canvas URLs, tool discovery, and institutional policies that disable personal access tokens.

## Repository Contents

The repository will include:

- Source code separated by configuration, Canvas client, formatters, tools, and entry point.
- Unit and integration tests with fixtures containing fictional data.
- README and client-specific configuration examples.
- MIT `LICENSE`.
- `CONTRIBUTING.md`.
- `SECURITY.md` with private vulnerability-reporting guidance.
- `.env.example` containing placeholders only.
- `.gitignore` rules covering environment files, tokens, build output, temporary downloads, and package-manager artifacts.
- GitHub Actions workflows for continuous integration and trusted npm publishing.
- Automated dependency update configuration.

## Testing and Verification

The release gate will require:

- Formatting and lint checks.
- Type checking.
- Unit tests for configuration, URL validation, pagination, formatting, bucket classification, and error mapping.
- Integration tests that exercise all eleven tools against mocked Canvas HTTP responses.
- Security tests proving that non-GET requests, cross-origin pagination, unsafe redirects, and token disclosure are rejected.
- A tool inventory test proving that exactly the approved eleven tools are registered.
- Package-content inspection to ensure tests, credentials, local files, and development artifacts are not published.
- An npm package smoke test that installs the packed tarball in a clean temporary directory and starts the stdio server.
- Manual smoke tests with at least Codex and one other standard MCP client before `0.1.0` is released.

No automated test will require or use a real Canvas token.

## Release and Supply-Chain Controls

- Pull requests and the default branch must pass CI.
- npm publishing will use GitHub Actions trusted publishing with provenance and no long-lived npm token when supported by the selected npm account configuration.
- Third-party GitHub Actions will be pinned to immutable commit SHAs.
- Releases will be created from version tags and include generated release notes.
- The npm package will publish only compiled runtime files, type declarations if applicable, README, license, and package metadata.
- Version `0.1.0` will be the first public validation release; breaking changes may occur before `1.0.0` and will be documented.

## Competitive Positioning

The package will not compete on tool count. Its public positioning will be:

> A minimal, student-focused, strictly read-only MCP server for Canvas LMS.

Compared with broad Canvas MCP servers, this project offers a smaller tool surface, a hard server-level read-only guarantee, simpler auditing, and lower risk when an AI client is given a Canvas token with more permissions than intended.

## Success Criteria for Version 0.1.0

- A new user can install the package from npm and connect it to Codex or another MCP client using only the README.
- The user can reproduce the nearest-deadline workflow demonstrated during design.
- All eleven tools function against documented Canvas API responses.
- No code path can issue a Canvas mutation request.
- No token appears in logs, errors, fixtures, repository history, or the npm package.
- CI and package smoke tests pass from a clean checkout.
- The published npm package includes provenance and links back to the public GitHub repository.

## Deferred Decisions

The following are intentionally deferred to future design work after version 0.1.0 feedback:

- Additional read-only tools such as calendar events, discussions, dashboard cards, or quiz metadata.
- A guided setup wizard.
- MCP bundle formats or client-specific one-click installers.
- Streamable HTTP transport.
- Optional local caching.
- Any write capability. Write operations would require a separate package or an explicit new security model rather than weakening this package's read-only guarantee.
