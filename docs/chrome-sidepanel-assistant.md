# Chrome side panel assistant

An LLM assistant in a Chrome side panel that manages Fleex workspaces (boards,
tickets, epics, deliverables) and can turn the current web page into a ticket or
deliverable.

## Why it's built on the CLI

The CLI `ticket`/`epic`/`board` commands are thin wrappers over the server's
internal API and are the **maintained, complete, self-documenting** surface
(`fleex documentation`). Rather than building on the smaller, less-maintained
agent API, the assistant's tools are **generated from the live CLI command
tree** and executed by running `fleex`. New CLI commands become tools for free.

## Components

```
Chrome extension (extension/)               thin client
  side panel chat + page capture
        │ ws://localhost:4399/chat
@fleex/sidepanel-host                        assistant host
  • holds ANTHROPIC_API_KEY
  • Messages API tool-use loop (opus-5, adaptive thinking, streaming)
  • gates mutating tools behind a WS confirmation round-trip
        │ in-process
@fleex/mcp                                   tool kernel (+ MCP stdio server)
  • generateTools(): CLI tree → typed tools (read/write classified)
  • execFleex(): run `fleex` via execFile, argv only (no shell)
        │
fleex CLI  →  internal API  →  domain (one server per workspace)
```

`@fleex/mcp` also ships a standalone **MCP stdio server** (`fleex-mcp`) so the
same tool surface is reusable by Claude Code, OpenClaw, and Claude Desktop.

## Security model

- **No shell**: tools run via `execFile` with an argv array; a page's content
  passed as `--description` is one inert argument — no injection, no quoting.
- **Gated writes**: read-only tools run automatically; create/update/move/
  delete require explicit user approval in the side panel (the exact `fleex …`
  command is shown). A decline is fed back to the model as an error result and
  never executed — the defense against prompt injection from page content.
- **Untrusted page content** is wrapped and labelled so the model treats it as
  reference, not instructions.
- **Non-interactive safety**: destructive commands' `--force` flag is injected
  after approval so the CLI never blocks on a prompt.
- The companion holds the Anthropic key server-side; the browser never sees it.

## Running

See `packages/sidepanel-host/README.md` (companion), `extension/README.md`
(extension), and `packages/mcp/README.md` (MCP server / reuse).
