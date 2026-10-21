# VS Code setup

Install Node.js 20.19 or newer. In VS Code, either:

- run `MCP: Open User Configuration` from the Command Palette for a personal
  configuration available across workspaces; or
- create `.vscode/mcp.json` for a workspace configuration.

Prefer the user configuration for a personal Canvas token so it cannot be
committed with a project. VS Code uses a top-level `servers` object and requires
the stdio server type:

```json
{
  "servers": {
    "canvas-lms": {
      "type": "stdio",
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

Run `MCP: List Servers`, start or restart `canvas-lms`, and inspect its tools.
Then ask in agent chat:

> List my active Canvas courses.

The example token is a placeholder. Never commit or share a real Canvas token.
See the [official VS Code MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)
for the current schema and commands.

Version `0.2.0-preview.2` is a published preview. Use the exact version in these
commands; the stable npm `latest` version remains `0.1.0`. See the
[installation guide](../INSTALL.md).
