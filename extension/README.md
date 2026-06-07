# Fleex Assistant — Chrome extension (MV3)

A side-panel chat that talks to an LLM which manages your Fleex workspaces
(boards, tickets, epics, deliverables) and can capture the current page into a
ticket or deliverable. It is a **thin client**: all intelligence and tool
execution live in `@fleex/sidepanel-host`, which the extension reaches over
`ws://localhost:4399/chat`.

## Setup

1. Start the companion (holds the Anthropic key, runs the assistant):

   ```bash
   export ANTHROPIC_API_KEY=sk-ant-...
   bun run packages/sidepanel-host/src/server.ts
   # in-repo dev: FLEEX_MCP_BIN=bun FLEEX_MCP_PREFIX="run $(pwd)/packages/cli/index.ts" bun run packages/sidepanel-host/src/server.ts
   ```

2. Load the extension: `chrome://extensions` → enable Developer mode →
   **Load unpacked** → select this `extension/` folder.

3. Click the toolbar icon to open the side panel.

## Use

- **Conversations** (☰): the hamburger opens a sidebar listing every
  conversation with a live status dot (grey = idle, blue = working, amber =
  awaiting your confirmation), its workspace and message count. Create one with
  **＋ New**, switch by clicking, rename with ✎, close with 🗑. Each conversation
  keeps its own history and workspace, persisted by the companion.
- **Chat**: ask "what should I work on on my board?", "create a ticket titled …".
- **📎 Page**: capture the current tab's content (heuristic extraction) and
  attach it as untrusted reference — then ask to "create a ticket from this
  page" or "add this as a deliverable on #123".
- **Workspace selector**: targets a specific workspace (passed as
  `--workspace`); persisted across sessions.
- **Confirmation**: read-only actions run automatically; create/update/move/
  delete show the exact `fleex …` command and wait for your Approve/Decline.

## Notes

- Page extraction is a dependency-free heuristic (prefers `<article>`/`<main>`,
  strips scripts/styles, caps at ~20k chars). Swapping in Readability + Turndown
  is a future build-step enhancement.
- `host_permissions` covers the companion (`http://localhost:4399/*`) plus
  `http://*/*` / `https://*/*` so the **📎 Page** button can read the active tab
  from the side panel. `activeTab` alone is insufficient here: it only grants
  host access when the extension is invoked from the toolbar icon, not when a
  button inside the persistent side panel is clicked. `chrome://`, the Chrome
  Web Store, and other extension pages remain unscriptable (expected).
