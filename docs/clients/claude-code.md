# Claude Code setup

This guide is for the coding assistant **Claude Code**. For ordinary Claude,
use the [Claude Desktop installer](../INSTALL.md).

Install Node.js 20.19 or newer. Claude Code can launch published preview
`0.2.0-preview.2` through npm without cloning/building this repository.
Privately set `CANVAS_BASE_URL` and `CANVAS_API_TOKEN` in the environment from
which you start Claude Code, then register the server for all projects:

```sh
claude mcp add --transport stdio --scope user canvas-lms -- npx -y mcp-server-canvas-lms@0.2.0-preview.2
```

Claude Code's spawned server inherits that environment. Do not paste the token
into the conversation, put it in a shared project file or commit it. If you use
an app launcher, ensure the private environment is available to that process.
Start a new session and run `/mcp` to inspect the connection. Ask “List my active
Canvas courses.” Never overwrite unrelated MCP entries when configuring a client.

See [Claude Code's MCP documentation](https://code.claude.com/docs/en/mcp)
and the [connection troubleshooting guide](../TROUBLESHOOTING.md).
