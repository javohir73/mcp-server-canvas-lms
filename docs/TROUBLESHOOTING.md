# Canvas connection help

## Tools do not appear

For Claude Desktop, check **Settings → Extensions**, enable Canvas LMS, verify
both settings are filled, and restart Claude. Remove duplicate manual entries.
An institution-managed app may require administrator approval. Use the installer
matching your computer, not another platform's build.

For npm clients, check Node.js is 20.19 or newer and the app can find `npx`.
Reconnect after changing configuration. The current preview has **13 tools**.
If npm cannot find `0.2.0-preview.2`, check your connection and whether npm uses
a private registry or mirror that has not synced the version. The public preview
is on npmjs.org; the older stable version does not include every preview feature.

## Canvas URL is rejected

Use the site root visible after signing into Canvas, such as
`https://canvas.example.edu`. Remove `/api/v1`, course/account paths, query
parameters and fragments. Do not use the university's general homepage.

## Authentication failed (401)

Your token may have expired or been revoked. Create a new token from your own
Canvas account, replace the value in the app's private settings and reconnect.
Changing the token preserves change history when the Canvas account is the same.
Do not share tokens or borrow someone else's.

## Access denied (403), no courses or missing files

Check the course is active and accessible to your account. Some institutions
restrict personal tokens, API access, downloads or particular resources. A
successful login or diagnostic check does not guarantee access to every resource.
Contact your institution's Canvas support if browser access works but API access
does not. This server cannot bypass those restrictions.

## Rate limited (429) or timeout

Wait and retry. Avoid running repeated whole-account queries in several apps at
once. Check your connection and whether Canvas itself is reachable. No deadline
change can be confirmed for a course that could not be fetched.

## Connection diagnostics for npm users

In a terminal where `CANVAS_BASE_URL` and `CANVAS_API_TOKEN` are already set
privately, run:

```sh
npx -y mcp-server-canvas-lms@0.2.0-preview.2 --doctor --json
```

The command reads its own
environment; it cannot read credentials saved inside Claude Desktop or another
app. It checks configuration and access to the active-courses endpoint. Its
report omits tokens, course names and raw responses. Never pass your token as a
command-line argument.

## Change history cannot be read or saved

See [history locations and reset instructions](HISTORY.md). Close Canvas MCP
clients before moving history files. A corrupt file is never silently replaced.
If a previous process crashed, an account `.lock` may remain: after closing every
Canvas MCP process, remove that stale lock and retry. Do not delete locks while
checks are running. Correct directory permissions or free space if saving fails.

## A document has no extracted text

Scanned PDFs need OCR, which is not included. Images, diagrams and original page
layout are not extracted. Corrupt, encrypted, unsupported or oversized files get
an explanation and, when possible, a temporary download path. Check the original
file in Canvas.

## Ask for help

Open a [GitHub issue](https://github.com/javohir73/mcp-server-canvas-lms/issues)
with your OS/processor, client, package version, the exact error and (optionally)
the diagnostic report. Do not attach tokens, settings files, student records,
history files or private coursework.
