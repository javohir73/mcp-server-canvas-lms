# Generic stdio MCP client setup

Install Node.js 20.19 or newer. In a client that accepts a JSON stdio server
definition, use this command and environment object:

```json
{
  "command": "npx",
  "args": ["-y", "mcp-server-canvas-lms@0.2.0-preview.2"],
  "env": {
    "CANVAS_BASE_URL": "https://canvas.example.edu",
    "CANVAS_API_TOKEN": "replace-with-your-personal-token"
  }
}
```

Place that object under the server name and surrounding key required by the
client's own documentation. Do not assume another client's configuration path
or top-level key. The client must launch local commands using MCP standard
input/output and must preserve stdout exclusively for MCP messages.

Restart or reconnect the client, confirm that thirteen tools are listed,
and ask:

> List my active Canvas courses.

The base URL must not include `/api/v1`. The example token is a placeholder;
never commit or share a real Canvas token.

Version `0.2.0-preview.2` is a release candidate; versioned npm commands work
after publication. See the [installation guide](../INSTALL.md) for availability.
