# Fleex Assistant — Chrome extension (MV3)

A side-panel chat that talks to an LLM which manages your Fleex workspaces
(boards, tickets, epics, deliverables) and can capture the current page into a
ticket or deliverable. It is a **thin client**: all intelligence and tool
execution live in `@fleex/sidepanel-host`, which the extension reaches over
`ws://localhost:4399/chat`.

## Setup

1. Put your Anthropic key in `~/.fleex/config` (once):

   ```bash
   echo 'ANTHROPIC_API_KEY=sk-ant-...' >> ~/.fleex/config
   ```

2. Start the companion. `fleex start` brings it up automatically alongside the
   stack, or start it on its own:

   ```bash
   fleex start            # stack + companion
   # or just the companion:
   fleex companion start  # idempotent; one singleton serves every workspace
   ```

   The companion is a **machine-wide singleton** on `ws://localhost:4399`: a
   single process serves all workspaces (each conversation carries its own
   `--workspace`). It runs from `~/.fleex/repo` (canonical install) — override
   with `FLEEX_COMPANION_REPO` for companion development.

3. Load the extension: `chrome://extensions` → enable Developer mode →
   **Load unpacked** → select this `extension/` folder.

4. Click the toolbar icon to open the side panel.

`fleex stop` leaves the companion running for other instances; it shuts down
with the **last** instance, and `fleex stop --all` always stops it.
`fleex companion status` / `fleex companion stop` manage it directly.

## Use

- **Conversations** (sidebar icon): opens a sidebar listing every
  conversation with a live status dot (grey = idle, blue = working, amber =
  awaiting your confirmation), its workspace and message count. Create one with
  **New**, switch by clicking, rename with the pencil icon, close with the trash
  icon. Each conversation keeps its own history and workspace, persisted by the
  companion.
- **Chat**: ask "what should I work on on my board?", "create a ticket titled …".
- **Page** (paperclip): capture the current tab's content (heuristic extraction) and
  attach it as untrusted reference — then ask to "create a ticket from this
  page" or "add this as a deliverable on #123".
- **Workspace selector**: targets a specific workspace (passed as
  `--workspace`); persisted across sessions. The side panel also adopts that
  workspace's **Fleex theme**: the companion reads the workspace's configured
  theme from its `app_config` (branch-agnostically, via `GET /theme`) and the
  panel re-skins to match — built-in palettes are bundled, custom themes come
  from the workspace's DB.
- **Model selector** (composer bar): picks the Anthropic model for the
  conversation. The list comes from the companion's `GET /models` (the canonical
  `FALLBACK_MODELS` shared with the web app); the choice is per-conversation and
  persisted. "Default model" leaves it to the companion default
  (`FLEEX_SIDEPANEL_MODEL` or `claude-opus-4-8`). The companion rebuilds the LLM
  per turn from the conversation's model.
- **Confirmation**: read-only actions run automatically; create/update/move/
  delete show the exact `fleex …` command and wait for your Approve/Decline.

## Hot reload (dev)

MV3 has no built-in hot reload, but the companion can drive one. Start it with
`FLEEX_SIDEPANEL_DEV=1`:

```bash
FLEEX_SIDEPANEL_DEV=1 FLEEX_MCP_BIN=bun \
  FLEEX_MCP_PREFIX="run $(pwd)/packages/cli/index.ts" \
  bun run packages/sidepanel-host/src/server.ts
```

It watches `extension/` and pushes a `dev_reload` over the WebSocket on change:

- editing `sidepanel.{html,css,js}` → the side panel reloads in place
  (`location.reload()`);
- editing `manifest.json` or `background.js` → a full `chrome.runtime.reload()`
  (the panel closes; reopen it from the toolbar icon).

No more clicking ↻ in `chrome://extensions` for everyday edits. (If a panel
reload ever serves stale JS in your Chrome build, do one manual extension reload
to flush, then continue.)

## Notes

- Page extraction is a dependency-free heuristic (prefers `<article>`/`<main>`,
  strips scripts/styles, caps at ~20k chars). Swapping in Readability + Turndown
  is a future build-step enhancement.
- `host_permissions` covers the companion (`http://localhost:4399/*`) plus
  `http://*/*` / `https://*/*` so the **Page** button can read the active tab
  from the side panel. `activeTab` alone is insufficient here: it only grants
  host access when the extension is invoked from the toolbar icon, not when a
  button inside the persistent side panel is clicked. `chrome://`, the Chrome
  Web Store, and other extension pages remain unscriptable (expected).
