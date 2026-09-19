# Fleex — « Work » view handoff

New single-screen ergonomics for Fleex, delivered as **one additional nav entry** (`Work`) that coexists with Kanban, Cockpit, Sessions and Assistant. Nothing existing is removed or changed in behaviour.

## Contents

| File | Purpose |
|---|---|
| `SPEC.md` | Functional + visual spec of the Work view: layout, every panel, every interaction, keyboard map, states |
| `DATA_MODEL.md` | What the view reads/writes, mapped to existing Fleex stores, routes and entities; the new pieces (agent threads) |
| `IMPLEMENTATION_PLAN.md` | Phased plan anchored on real repo files (paths, stores, routes), non-regression rules, acceptance checklist, suggested PR split |
| `DESIGN_TOKENS.md` | Colors/spacing used by the prototype → Fleex `--theme-*` tokens; component-level style notes |
| `prototype/Fleex-Work-Prototype.dc.html` | Interactive HTML prototype (open in a browser with `support.js` alongside). **The reference for behaviour and layout.** |
| `prototype/Fleex-Directions-1a-1d.dc.html` | The four initial directions explored (canvas). Direction 1b + the live pane of 1c were retained. |
| `screenshots/` | Key states (captured at ~920px wide — cropped on the right; open the prototype for full width) |

## How to use with Claude Code

```
cd fleex
claude
> Read handoff/README.md, handoff/SPEC.md, handoff/DATA_MODEL.md and handoff/IMPLEMENTATION_PLAN.md.
> Then open handoff/prototype/Fleex-Work-Prototype.dc.html and read its <x-dc> template and Component class to understand the target behaviour.
> Implement Phase 1 as described, as a new `work` panel. Do not modify existing panels' behaviour.
```

Recommended: one PR per phase (see IMPLEMENTATION_PLAN.md § PR split).

## Non-negotiables

1. **Additive only.** New `ActivePanel` value `'work'`, new route `/work`, new nav item. Existing routes, stores and panels keep working byte-for-byte.
2. **Reuse, don't fork.** Terminals = existing `TerminalView`/session tabs; agent stream = `AgentEventStream` + `agentEventStore`; activity = `ticketActivityStore`; comments/mentions = `TicketComments` primitives; overlay sync = `OverlaySyncButton`; pinned actions = the existing pinned-icons settings.
3. **Ticket is the persistence.** The Work view has no data of its own except UI state (open panel, shell layout, filter) persisted in `localStorage` under `fleex_work_*`.
4. **Agent threads (Phase 3) need a server change** — scoped in DATA_MODEL.md. Phases 1–2 ship without it.
