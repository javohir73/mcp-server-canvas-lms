# Install Canvas LMS MCP

Choose the app you use. Pasting this GitHub repository into an ordinary Claude
or ChatGPT conversation does not install software automatically.

## Claude Desktop: download an installer

**0.2.0-preview.2** is available from the
[GitHub preview release](https://github.com/javohir73/mcp-server-canvas-lms/releases/tag/v0.2.0-preview.2).
Choose the download matching your computer:

| Computer                                   | Installer                                                                                                                                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mac with Apple M-series chip               | [Download for Apple Silicon](https://github.com/javohir73/mcp-server-canvas-lms/releases/download/v0.2.0-preview.2/mcp-server-canvas-lms-0.2.0-preview.2-darwin-arm64.mcpb) |
| Mac with an Intel processor                | [Download for Intel Mac](https://github.com/javohir73/mcp-server-canvas-lms/releases/download/v0.2.0-preview.2/mcp-server-canvas-lms-0.2.0-preview.2-darwin-x64.mcpb)       |
| Windows with an Intel/AMD 64-bit processor | [Download for Windows x64](https://github.com/javohir73/mcp-server-canvas-lms/releases/download/v0.2.0-preview.2/mcp-server-canvas-lms-0.2.0-preview.2-win32-x64.mcpb)      |

On a Mac, **Apple menu → About This Mac** shows Chip or Processor. On Windows,
**Settings → System → About → System type** shows your architecture. These
Windows installers are not native Windows ARM builds. Linux users can use npm.

1. Install/open Claude Desktop.
2. Open **Settings → Extensions → Advanced settings → Install Extension**.
3. Select the matching `.mcpb` and follow the prompts.
4. Enter your university's Canvas site root, such as `https://canvas.example.edu`.
5. Enter **your own** Canvas access token in the sensitive token field.
6. Enable the extension, start a conversation, and ask “List my active Canvas courses.”

Claude Desktop supplies the Node runtime; no terminal or separate Node installation
is required for the extension. Organisation settings can restrict installation.
The bundles are validated and their packaged servers exercised automatically;
that does not verify every screen in Claude Desktop. See
[Claude's official guide](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop).

Privately downloaded installers do not update themselves. Install the new matching
bundle when you want an update. Disable a previous manual Canvas configuration
so you do not get duplicate tools.

## Get your own Canvas token

Open Canvas in your browser, then **Account → Settings → Approved Integrations
→ New Access Token**. Give it a recognisable name and choose an expiry date.
Copy it into the app's private configuration field. Do not paste it into an AI
conversation, GitHub issue or shared project file. If the button is unavailable,
your institution may disable personal tokens; ask Canvas support.

## Other local MCP clients: npm

Install Node.js **20.19 or newer**. An MCP client launches the package with:

```sh
npx -y mcp-server-canvas-lms@0.2.0-preview.2
```

This exact preview version is published to npm. The stable `latest` version
remains `0.1.0` and does not contain all preview features.
No global npm installation is needed. Configure `CANVAS_BASE_URL` and
`CANVAS_API_TOKEN` privately in your client. Launching the command by itself in a
terminal starts a protocol server; it does not open a chat interface.

Use the guide for [Claude Code](clients/claude-code.md),
[Codex](clients/codex.md), [Cursor](clients/cursor.md),
[VS Code](clients/vscode.md), or [another local client](clients/generic.md).

## Claude in a browser and ChatGPT

The current package runs locally over standard input/output. It does not provide
a public remote connector URL. A GitHub URL or npm package cannot be installed
directly in ordinary browser chat. A hosted, individually authenticated connector
is a separate future upgrade.

## Try these prompts

- “What should I focus on this week? Check my deadlines and recent announcements.”
- “Read my assignment brief, explain the requirements and link to the source.”
- “What changed since my last check? Use Canvas change tracking.”

The first change check saves a baseline. Later checks compare against it; there
are no automatic checks or notifications. See [local history](HISTORY.md).

If connection fails, use the [troubleshooting guide](TROUBLESHOOTING.md).
