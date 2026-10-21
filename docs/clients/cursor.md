# Cursor setup

Install Node.js 20.19 or newer. Cursor supports these documented MCP
configuration locations:

- Project: `.cursor/mcp.json`
- Global: `~/.cursor/mcp.json`

Use the global file for a personal Canvas token so it cannot be committed with
a project. Add the server under the top-level `mcpServers` object:

```json
{
  "mcpServers": {
    "canvas-lms": {
      "command": "npx",
      "args": ["-y", "mcp-server-canvas-lms@0.2.0-preview.2"],
      "env": {
        "CANVAS_BASE_URL": "https://canvas.example.edu",
        "CANVAS_API_TOKEN": "replace-with-your-personal-token"
      }
    }
  }
}
```

Restart Cursor, open the MCP tools list in settings, and confirm the server and
its eleven tools are enabled. Then ask:

> List my active Canvas courses.

The example token is a placeholder. Never commit or share a real Canvas token.
See the [official Cursor MCP documentation](https://docs.cursor.com/context/model-context-protocol)
for current configuration and tool controls.

Version `0.2.0-preview.2` is a published preview. Use the exact version in these
commands; the stable npm `latest` version remains `0.1.0`. See the
[installation guide](../INSTALL.md).
