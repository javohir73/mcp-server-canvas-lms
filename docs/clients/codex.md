# Codex setup

Codex's local clients share MCP configuration through
`~/.codex/config.toml`. The ChatGPT desktop app, Codex CLI, and Codex IDE
extension can therefore use the same local server entry.

With Node.js 20.19 or newer installed, run:

```sh
codex mcp add canvas-lms --env CANVAS_BASE_URL=https://canvas.example.edu --env CANVAS_API_TOKEN=replace-with-your-personal-token -- npx -y mcp-server-canvas-lms
```

Replace the example origin and token with your own values. The base URL must
not include `/api/v1`, and the token must never be committed or shared.

Run `codex mcp list` to confirm that `canvas-lms` is configured. In a Codex
session, use `/mcp` to confirm the connection, then ask:

> List my active Canvas courses.

See the [official Codex MCP documentation](https://developers.openai.com/codex/extend/mcp)
for the current CLI, desktop, IDE, and `config.toml` options.
