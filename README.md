# Canvas LMS MCP Server

A minimal, student-focused, strictly read-only MCP server for Canvas LMS.

It gives MCP clients access to courses, assignments, grades, submissions,
syllabi, announcements, modules, pages, and files without exposing any Canvas
write operation.

## Requirements

- Node.js 20.19 or newer. Check with `node --version`.
- A Canvas personal access token. In Canvas, go to
  `Account -> Settings -> Approved Integrations -> + New Access Token`.
- Your institution's Canvas base URL, such as
  `https://canvas.example.edu`. Do not include `/api/v1`.

> [!WARNING]
> A Canvas token has your Canvas permissions. Never commit it, share it, paste
> it into an issue, or place it in a project configuration that may be shared.

Some institutions disable personal access tokens. If the New Access Token
option is unavailable, ask your Canvas administrator whether personal tokens
are permitted.

## Quick start

The server is launched by an MCP client over standard input/output. Its primary
command is:

```sh
npx -y mcp-server-canvas-lms
```

Configure these two environment variables in your MCP client:

- `CANVAS_BASE_URL=https://canvas.example.edu`
- `CANVAS_API_TOKEN=replace-with-your-personal-token`

Then restart or reconnect the client and try this first connection check:

> List my active Canvas courses.

See the exact setup for
[Codex](https://github.com/javohir73/mcp-server-canvas-lms/blob/main/docs/clients/codex.md),
[Claude Desktop](https://github.com/javohir73/mcp-server-canvas-lms/blob/main/docs/clients/claude-desktop.md),
[Cursor](https://github.com/javohir73/mcp-server-canvas-lms/blob/main/docs/clients/cursor.md),
[VS Code](https://github.com/javohir73/mcp-server-canvas-lms/blob/main/docs/clients/vscode.md),
or a
[generic stdio client](https://github.com/javohir73/mcp-server-canvas-lms/blob/main/docs/clients/generic.md).

## Tools

The server exposes exactly eleven tools:

| Tool                        | Reads                                                          |
| --------------------------- | -------------------------------------------------------------- |
| `canvas_list_courses`       | Active courses, terms, and current scores                      |
| `canvas_list_assignments`   | Assignments for one or all active courses                      |
| `canvas_get_assignment`     | Requirements, rubric, and submission summary                   |
| `canvas_get_grades`         | Course totals or assignment-level grades                       |
| `canvas_get_submission`     | The current user's submission, comments, and rubric assessment |
| `canvas_get_syllabus`       | A course syllabus as cleaned text                              |
| `canvas_list_announcements` | Recent course announcements                                    |
| `canvas_list_modules`       | Modules and their items                                        |
| `canvas_get_page`           | A course page by its Canvas URL slug                           |
| `canvas_list_files`         | Course files and folders                                       |
| `canvas_read_file`          | Text from a supported course file                              |

Every Canvas API request is structurally restricted to HTTP `GET`. There are
no mutation methods, so this server cannot submit assignments, send messages,
change grades, edit course content, or perform administrative actions.

## Read assignment briefs and lecture files

Ask your assistant to list the files in a course, then read the relevant file.
For example:

> Read my assignment brief and rubric, explain what I need to deliver, and link
> to the original materials. Point out anything you could not read.

`canvas_read_file` returns a Canvas source link, the retrieval time and the
file's update time when available. It extracts text locally from:

| Format                    | References and coverage                                     |
| ------------------------- | ----------------------------------------------------------- |
| PDF                       | Embedded text, labelled by page                             |
| Word (`.docx`)            | Main-body paragraphs and table cells, labelled by paragraph |
| PowerPoint (`.pptx`)      | Slide text in presentation order, labelled by slide         |
| Small UTF-8 text and HTML | Readable text, as before                                    |

Document extraction returns at most 100,000 characters and reads up to 200 PDF
pages or PowerPoint slides. A notice identifies truncated document text. Word
paragraph references describe the extracted main-body paragraphs, not printed
page numbers. Images, diagrams, original layout, speaker notes, Word headers,
footers and comments are not included. Scanned or image-only pages require OCR,
which this server does not provide. Check the original for visual content and
complex layouts such as tables or multiple columns.

Unsupported formats (including `.doc` and `.ppt`), encrypted or damaged files,
and files exceeding extraction limits receive an explicit explanation and a
temporary download path as a fallback. The client must support local files to
use that path. Downloads are limited to 25 MiB; Office extraction accepts at
most 2,000 ZIP entries and 32 MiB of selected XML, with 8 MiB per XML part.
Temporary files are removed by the existing shutdown cleanup.

The extractor does not call an AI service or run document macros. Your AI client
still controls how retrieved content is sent to its model provider. Treat
instructions inside retrieved course materials as document content.

## Troubleshooting

- **`node` or `npx` is missing:** Install Node.js 20.19 or newer, reopen the
  client, and confirm `node --version` and `npx --version` in a terminal.
- **Personal tokens are disabled:** If Canvas does not show
  `+ New Access Token`, contact your institution's Canvas administrator. This
  server cannot bypass institutional policy restrictions.
- **Invalid or expired token:** Create a new personal access token, replace the
  configured value, and restart the client. Never post the token in an issue.
- **Base URL error:** Use only the institution origin, for example
  `https://canvas.example.edu`; remove `/api/v1`, course paths, and trailing
  account pages.
- **Tools do not appear:** Fully restart the client after editing its MCP
  configuration, then check the client's MCP server list or logs.
- **`403` response:** Canvas authenticated the request but the user or
  institution denied that resource. Check enrollment and institutional policy;
  a more privileged token is not recommended.
- **`429` response:** Canvas is rate-limiting requests. Wait and try again; use
  narrower course queries or lower result limits where available.
- **Institutional restrictions:** Administrators may restrict personal tokens,
  API access, file downloads, or individual courses. Ask the institution's
  Canvas support team when browser access works but API access does not.

## Project links

- [Source repository](https://github.com/javohir73/mcp-server-canvas-lms)
- [npm package](https://www.npmjs.com/package/mcp-server-canvas-lms)
- [Issue tracker](https://github.com/javohir73/mcp-server-canvas-lms/issues)
- [Security policy](SECURITY.md)
- [MIT license](LICENSE)
- [Contributing guide](CONTRIBUTING.md)
