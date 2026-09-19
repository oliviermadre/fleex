# IMPLEMENTATION_PLAN — Work view as an additional nav entry

Principle: **additive, zero regression**. Existing panels (`tickets`, `list-focus`, `sessions`, `assistant`, …) are untouched. The Work view is a new `activePanel` rendered by `MainPanel`, and reuses existing stores/components.

## Wiring (Phase 0 — ½ day)

1. `packages/web/src/stores/uiStore.ts` — add `'work'` to `ActivePanel`.
2. `packages/web/src/router/RouterSync.tsx` — add `'work'` to its local `ActivePanel`; `parseUrl`: `/work` → `{ panel: 'work' }` (+ optional `/work/:ticketId`); `storeToUrl`: `case 'work'`; `navIdentity` unchanged (panel + ticket id suffice).
3. `packages/web/src/components/sidebar/NavSidebar.tsx` — new `NavItem` **Work** placed first in the Operational group (before Kanban). Icon: a 2-column layout glyph (`◧`). Badge = count of `waiting` tickets from `ticketActivityStore` (optional).
4. `packages/web/src/components/layout/AppLayout.tsx` — add `activePanel === 'work'` to `hideContentPanel`.
5. `packages/web/src/components/main-panel/MainPanel.tsx` — `if (activePanel === 'work') return <WorkView />;` (before the sessions fallbacks).
6. Command palette (`useCommandItems.tsx`) — add `Go to Work`.
7. Feature flag: `settingsStore` boolean `workViewEnabled` (default true in dev, configurable) — lets you hide the nav item without code changes.

Acceptance: every existing route still resolves identically (run the RouterSync tests; add cases for `/work`). No existing component imports the new files.

## Phase 1 — Core screen (queue · conversation · context · new task) — ~3–4 days

Files (new): `components/work/WorkView.tsx`, `WorkTopBar.tsx`, `WorkStatusBar.tsx`, `queue/WorkQueue.tsx`, `queue/QueueRow.tsx`, `task/TaskHeader.tsx`, `task/TaskStream.tsx`, `task/StreamItem.tsx`, `task/InlineQuestion.tsx`, `task/Composer.tsx`, `task/NextStrip.tsx`, `task/Suggestions.tsx`, `panel/ToolStrip.tsx`, `panel/ContextPanel.tsx`, `panel/DelivsPanel.tsx`, `new/NewTask.tsx`, `stores/workStore.ts`, `work/selectors.ts` (queue partition + suggestion rules), `work/keyboard.ts`.

- Queue partition (`selectors.ts`): `waiting → needs`, `running → running`, else `idle`; sort needs by `since` asc, running by `since` desc, idle by `lastActivityAt` desc. Board filter from `ticketStore`. Unit-test the partition and the suggestion rules.
- Conversation: reuse comment rendering (`MarkdownRenderer`, mention chips). Event lines from the ticket's domain event log. Inline question: detect `waiting_for_info` mention + parse options (bullets / `a) b)` / `1. 2.`); answering posts a comment and optimistically flips the mention.
- Composer: reuse `useMentionAutocomplete` + `MentionMenu`; `Mode`, persona, model selectors reuse the existing components from `TicketComments`.
- Context panel: status/board/type/size mutations via existing ticket mutation API; worktree attach/detach via existing flows; deliverables open the existing overlay.
- New task: `create-ticket` → per-repo `create-worktree` → first comment. Title = first sentence ≤ 70 chars. Emit toast on each failure but keep going (ticket without worktree is valid).
- Top/status bars: `OverlaySyncButton`, pinned actions (same source as `WorktreeHeader`), `NotificationNavItem`.

Acceptance: switching Work ↔ Kanban ↔ Sessions keeps selections; creating a task from Work shows it in Kanban immediately; answering an inline question resolves the mention visible in Sessions/Kanban.

## Phase 2 — Shell drawer, shell mode, diff, code — ~3 days

- Shell: bind ticket sessions (tab engine kinds `claude`/`shell`) into panes. Reuse `TerminalView` for xterm instances (one per session; keep instances mounted when hidden to avoid re-attach cost — render the drawer with `display:none` rather than unmounting). Layout presets in `workStore.shellLayout`; ⌘1-4 focus; `+` creates a shell via `create-session-from-ticket`.
- Shell mode: same panes rendered in the center slot instead of the stream; queue and right panel stay mounted.
- Diff/Code panels: new read endpoints (DATA_MODEL.md § Phase 2); poll every 5s while panel open or on `agent_event` tool_result of kind Edit/Write. `Open in VS Code` reuses the workspace action; `code-server` link behind a setting.

Acceptance: floating sessions and the Sessions view keep working with the same session ids; killing a shell from Sessions removes it from the drawer.

## Phase 3 — Assistant ⇄ agent threads — ~1–2 weeks (server)

See DATA_MODEL.md § Phase 3. Ship behind `workThreadsEnabled` flag. UI: `task/DelegationCard.tsx`, `panel/ThreadsPanel.tsx` (Conversation + `AgentEventStream` for the stream tab). Until the server part lands, the Threads tool is hidden and `@agent:` mentions render as agent messages (Phase 1 behaviour).

## Non-regression rules

- No edits to `TicketDetail`, `KanbanBoard`, `ListFocusView`, `UnifiedWorktreePanel`, `AssistantConversation` beyond exporting already-existing subcomponents if needed (prefer extracting into `components/shared/` with the old import re-exported).
- `uiStore` additions are optional fields with defaults; no renames.
- All new localStorage keys prefixed `fleex_work`.
- Mobile (`MobileApp`) unaffected; `/work` on mobile → redirect `/tickets`.
- Tests: RouterSync parse/serialize for `/work`; queue partition; suggestion rules; inline option parser; shell layout reducer (split/close transitions).

## Suggested PR split

1. `feat(work): nav entry, route and empty WorkView shell` (Phase 0)
2. `feat(work): queue + task stream + context panel + new task` (Phase 1)
3. `feat(work): shell drawer/mode with split layouts` (Phase 2a)
4. `feat(work): diff and code panels + endpoints` (Phase 2b)
5. `feat(threads): agent_thread entity, assistant delegate tool, WS events` (Phase 3 server)
6. `feat(work): delegation cards and threads panel` (Phase 3 UI)

## Definition of done (per PR)

- `pnpm static-code-analysis`, `knip:gate`, `build --affected`, tests green.
- Manual: open `/tickets`, `/list-focus`, `/sessions`, `/assistant` — identical behaviour; open `/work` — matches `handoff/prototype/Fleex-Work-Prototype.dc.html` for the phase's scope.
