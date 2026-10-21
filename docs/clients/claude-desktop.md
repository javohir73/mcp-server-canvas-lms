# Claude Desktop setup

## Installer preview

If you have a Canvas LMS `.mcpb` file built for your platform and architecture,
open it with Claude Desktop and follow the extension installation prompts. Enter
your university's Canvas URL and personal access token in the provided fields.
The token field is marked sensitive so the host can mask and securely store it.
No manual JSON editing is needed for this installation path.

The current local preview is built for **macOS on Apple Silicon (darwin-arm64)**.
The installer includes the upgraded document reader and its runtime dependencies.
It has been validated and its packaged server tested; the installation flow has
not been exercised in the Claude Desktop UI. Institutional settings may restrict
extension installation. See the
[official desktop-extension format](https://github.com/modelcontextprotocol/mcpb)
for host support and installation details.

After enabling the extension, ask:

> List my active Canvas courses.

Then try reading a PDF assignment brief from one of those courses. If you already
configured a manual Canvas server, disable the duplicate entry in Claude's
settings so the tools appear only once.

Developers can build the extension with `npm ci` followed by
`npm run build:mcpb`. The output filename includes the build platform and
architecture. Build on each target machine type before sharing it.

## Manual setup

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
