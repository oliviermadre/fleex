# Chrome side panel assistant

The Fleex Assistant in a Chrome side panel (the same companion serves the
web/desktop panel and the mobile tab). It can turn the current web page into a
ticket or deliverable, and do anything a Fleex persona can.

## Since the Assistant runs on the Claude Agent SDK

The companion no longer runs its own Messages-API loop with generated `fleex_*`
tools. Each conversation is a Claude Agent SDK session built exactly like a
persona run (see `packages/sidepanel-host/README.md`): all Claude Code tools,
the user's MCP servers and skills, the whole `fleex` CLI through Bash,
`bypassPermissions`.

## Security model

- **Same trust as a persona**: the Assistant has the local user's rights. Bash,
  MCP calls and `fleex` writes run without asking. Accepted risk: a malicious
  page attached to the conversation can make it run commands (its content is
  labelled as data, not instructions, and nothing more).
- **One confirmation**: a file write (`Write`/`Edit`/`NotebookEdit`) outside the
  conversation folder, symlinks followed. "Always" is per conversation and
  revocable from the header chip.
- **Who may drive it**: the companion listens on `127.0.0.1` only, so nothing
  on the LAN or the tailnet reaches it directly. The WebSocket only accepts
  Fleex's own origins (the extension, localhost pages, this machine's own
  `*.ts.net` name). Without that check any web page open in the browser could
  connect to `ws://localhost:4399` and run Bash.
- **Attribution**: everything it does in Fleex is signed "Assistant"
  (`FLEEX_ACTOR_*`).
- **`access` on CLI commands**: each `fleex` command declares `read`, `write` or
  `destructive`; the Assistant shows it as a badge on Bash lines (display only)
  and the MCP server derives its `readOnlyHint` / `destructiveHint` from it.

`@fleex/mcp` still ships the standalone MCP stdio server (`fleex-mcp`) for
Claude Code, Claude Desktop and others.

## Running

See `packages/sidepanel-host/README.md` (companion), `extension/README.md`
(extension), and `packages/mcp/README.md` (MCP server / reuse).
