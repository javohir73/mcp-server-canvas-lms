# Contributing

Thank you for helping improve `mcp-server-canvas-lms`.

## Safety requirements

- Use only fictional fixtures and example Canvas domains in tests and
  documentation.
- Never use, commit, log, or paste a live Canvas token or private course data.
- Keep Canvas access strictly read-only. All Canvas API and file requests must
  use HTTP `GET`; do not add mutation methods or write-capable endpoints.
- Keep changes focused and add focused tests for each behavior change or bug
  fix.

Write-capable behavior belongs in a separate project with a separate security
model. Pull requests that weaken the read-only guarantee will not be accepted.

## Development

Use Node.js 20.19 or newer and install dependencies with `npm ci`. Before
opening a pull request, run:

```sh
npm run lint && npm run typecheck && npm test
```

Describe the user-visible change, tests performed, and any security impact in
the pull request. By contributing, you agree that your contribution is
licensed under the MIT License.
