# Claude Desktop setup

Install Node.js 20.19 or newer. In Claude Desktop, open
`Settings -> Developer -> Edit Config`. This opens or creates
`claude_desktop_config.json` in the documented application configuration
location:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Add the `canvas-lms` entry under the top-level `mcpServers` object. If the file
already contains other servers, merge this entry rather than replacing them.

```json
{
  "mcpServers": {
    "canvas-lms": {
      "command": "npx",
      "args": ["-y", "mcp-server-canvas-lms"],
      "env": {
        "CANVAS_BASE_URL": "https://canvas.example.edu",
        "CANVAS_API_TOKEN": "replace-with-your-personal-token"
      }
    }
  }
}
```

Fully quit Claude Desktop and reopen it. Confirm that `canvas-lms` appears in
the connectors/tools menu, then ask:

> List my active Canvas courses.

The example token is a placeholder. Never commit or share a real Canvas token.
See the [official MCP local-server guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers)
for Claude Desktop's current configuration workflow.
