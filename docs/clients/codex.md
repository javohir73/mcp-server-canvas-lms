# Codex setup

Codex's local clients share MCP configuration through
`~/.codex/config.toml`. The Codex desktop app, Codex CLI, and Codex IDE
extension can therefore use the same local server entry.

With Node.js 20.19 or newer installed, run:

```sh
codex mcp add canvas-lms --env CANVAS_BASE_URL=https://canvas.example.edu --env CANVAS_API_TOKEN=replace-with-your-personal-token -- npx -y mcp-server-canvas-lms@0.2.0-preview.2
```

Replace the example origin and token with your own values. The base URL must
not include `/api/v1`, and the token must never be committed or shared.

Run `codex mcp list` to confirm that `canvas-lms` is configured. In a Codex
session, use `/mcp` to confirm the connection, then ask:

> List my active Canvas courses.

See the [official Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
for the current CLI, desktop, IDE, and `config.toml` options.

Version `0.2.0-preview.2` is a published preview. Use the exact version in these
commands; the stable npm `latest` version remains `0.1.0`. See the
[installation guide](../INSTALL.md).
