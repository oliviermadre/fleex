# Work view — implementation status

Single-screen "Work" ergonomics (handoff package at `../handoff/`, root of the worktree).
Branch `ticket/b12c65-focus-view` · PR **#278** (base `main`). This doc is the resume
point across context resets — update it as work progresses.

## Where we are

**Phase 0 (wiring) + Phase 1 (core screen) are DONE and committed** (first commit `308d11ac`),
plus 9 rounds of user feedback ("salves"). Verified green throughout:
`bun run test` (packages/web) → 742 passing; `tsc --noEmit -p packages/web` clean;
`node scripts/check-raw-palette.mjs` clean (theme tokens only).

Run checks from `packages/web`: `../../node_modules/.bin/vitest run` (deps installed via `bun install` at repo root).

### Done

- **Wiring**: `work` in `ActivePanel` (`stores/uiStore.ts` **and** `router/RouterSync.tsx` — two copies),
  `/work` parse/serialize (+ tests in `RouterSync.test.ts`), `MainPanel` branch, `AppLayout`
  `hideContentPanel`, command-palette "Go to Work" (`useCommandItems.tsx`), `NavSidebar` entry,
  `workViewEnabled` flag (`settingsStore`, default on). Guard added in `hooks/useKeyboardShortcuts.ts`
  so ⌘⇧↑/↓ defers to Work.
- **Queue** (`components/work/queue/`): real tickets grouped by activity/status/board/repo/type/priority
  (`useWorkQueue.ts` `groupTasks`); status filter (default doing+reviewing) + board/priority
  multi-selects + favorite toggle + search; per-row inline-editable favorite/priority/type/blocked;
  resizable + collapsible (`CollapsedQueueRail`); ⌘⇧↑/↓ nav (`keyboard.ts`).
- **Conversation** (`components/work/task/`): real comments (`useTaskConversation.ts` → `api.fetchTicketComments`/`postTicketComment`);
  shared `MarkdownRenderer` via `MessageMarkdown.tsx` (mention chips, checkboxes, code highlight);
  inline question answering (`InlineQuestion.tsx` + `parseInlineOptions`); suggestion chips
  (`Suggestions.tsx` + `suggestionsFor`); composer with `@`-autocomplete
  (`Composer.tsx` + `useMentionAutocomplete`/`MentionMenu`/`useAllMentionOptions`); description
  shown as a distinct init block (`TaskStream.tsx`).
- **Context panel** (`components/work/panel/`): Board/Status/Type/Priority pickers
  (`WorkBoardPicker`, `WorkStatusPicker`, reused `TypePickerPopover`/`PriorityPickerPopover`),
  favorite/blocked/due-date (`DueDatePickerPopover`), repos + PRs attach/detach (via `addLink`/`removeLink`),
  resizable (`RightPanel.tsx`). Deliverables panel (`DelivsPanel.tsx`, `useTicketDeliverables.ts`)
  with live (WS) count badge on the tool strip.
- **New task** (`components/work/new/`): board/type/priority pickers + repos multi-select; creates a
  real ticket (+ `repository` links); tool strip & status bar hidden while composing.
- **Reusable** `components/ui/MultiSelect.tsx` (searchable checkbox popover, SmartSessionButton design).
- **State**: `stores/workStore.ts` (persisted `localStorage['fleex_work']`).

## What's next (not yet built)

### Phase 1 polish (optional, small)
**Session 2 (this branch, not yet committed):**
- ✅ **PR state colour** — `ContextPanel.tsx` now fetches `api.fetchPRStates(ticket.id)` on ticket
  change and maps GitHub's `OPEN|MERGED|CLOSED` → `PrBadge` state (was hardcoded `state:'open'`).
- ✅ **Comment stream live-updates via WS** — `useTaskConversation.ts` subscribes to `appWs.onChannel('tickets')`
  and applies `comment:created|updated|deleted` in place for the current ticket (was refetch-only).
- ✅ **Event lines in the stream** — `selectors.ts` `formatActivity` + `buildStream` (pure, tested: 31 cases)
  merge `api.fetchTicketActivity` rows into the comment stream chronologically; rendered by
  `task/EventLine.tsx` (grey ✓ line). `useTaskConversation` fetches activity alongside comments and
  refetches it on `ticket:updated|moved` (no dedicated activity WS event). `commented`/`updated`/internal
  rows are dropped so the stream is history, not an audit dump.
- ~~New task: create actual git worktrees~~ — **WON'T DO**: worktrees are created lazily
  (on tmux session open / agent trigger, via `createSessionFromTicket`). Eager creation at ticket
  creation would materialise worktrees for repos that may never be touched. Attaching `repository`
  links is enough; the SPEC §8 "one worktree per repo on Start" is superseded by the lazy pattern.

- ✅ **Top bar actions** — `WorkTopBarActions.tsx` (new) adds `OverlaySyncButton` (scoped to the selected
  ticket's workspace) + `PINNED` label + pinned icons (`executePinnedAction`) + ticket-scoped workspace
  actions (`executeWorkspaceAction` w/ `buildWorkspaceContext`), reusing the WorktreeHeader primitives.
  Wired into `WorkTopBar` (`selectedTaskId`).
- ⏸️ **AGENTS section (Context)** — built then **removed from the sidebar** (deferred like Suggestions):
  static, non-clickable, thin value without click-through. The pure `personasForTicket` selector + its
  tests are KEPT for the future AGENTS/threads task. The persona/execution data now feeds the stream
  run cards instead (see Timeline below).

**Still open:**
- NEXT strip (SPEC §5) — **DROPPED**: no backend "next step" source; would duplicate the
  already-built `Suggestions` (client-derived `suggestionsFor`). Low value.

### Phase 1 polish — COMPLETE (session 2)
All actionable polish items are done + verified (tsc clean · 760 tests · palette clean). Not yet committed.
Dropped by design: eager worktree creation (lazy pattern), NEXT strip (duplicates Suggestions).

**Session-2 UX adjustments (also uncommitted):**
- Status bar breadcrumb 3rd segment is now the **full workspace path + a copy-to-clipboard button**
  (`WorkStatusBar.tsx` `CopyButton`; path via `buildWorkspaceContext`), replacing `⎇ repo · branch`.
- Status bar right side trimmed to **agent activity + cost** (bottom-right); PR / repo-count / status
  removed as redundant with the Context sidebar.
- Context sidebar ticket **cost footer removed** — cost lives only in the status bar now.
- **Suggestion chips removed from the chat** (`TaskPane` no longer renders `Suggestions`). The
  `Suggestions.tsx` component + `suggestionsFor` selector + tests are KEPT for a future dedicated task.
- **Queue row redesign (variant A)** — one line, more room for the title:
  - **Type → SVG line icon** `TicketTypeIconSvg` (hammer/bug/eye/gear/briefcase/bulb per type, tinted via
    `TYPE_COLORS`; neutral grey square for null "Task"). Still inline-editable: `TypePickerPopover` gained a
    non-breaking `display: 'label' | 'icon' | 'icon-label'` prop (default `label`). Queue uses `icon`, the
    Context sidebar `icon-label`; the picker **dropdown always shows icon + label + description** to anchor
    the type↔icon mapping.
  - **Activity timer** `QueueActivityTimer` — compact coloured age by SDK state (gray idle / blue running /
    yellow waiting), live off `useNow`+`formatAge`; on row hover it expands leftward (animated, respects
    reduced-motion) to `idle for {age}` / `Running for {age}` + a status dot. Running/waiting with an
    execution is clickable → execution log (shared `FloatingExecutionPanel` lifted to `WorkView`, also used
    by timeline run cards). State is SDK-only, never inferred from cli/tmux or ticket status.
  - **Blocked/favorite pictos** collapse to zero width (display:none) until row hover unless the flag is set.
  - Running progress bar + detail line kept (so a running row stays compact, not 3 lines).

**Session-2 Timeline (conversation stream enriched, uncommitted):**
- `buildStream` (selectors.ts, pure + tested) now weaves **agent runs** and **deliverables** into the
  comment/event timeline: a `run` entry at `execution.startedAt` (lands just before the comment it
  produced), a `deliverable` entry at `createdAt` (just after). Tie-break: run → comment → deliverable → event.
- `task/RunCard.tsx` (new) — persona + state (running/ran/failed/interrupted) + duration·cost, **clickable →
  execution log** via the reused `FloatingExecutionPanel` (owned by `TaskPane`). All runs show, even failed/empty.
- `task/DeliverableCard.tsx` (new) — `DeliverableTypeBadge` + title + author/draft/version, **clickable →
  `openDeliverableOverlay`** (globally-mounted overlay), marks seen like the Delivs panel.
- `formatActivity` now drops `deliverable_submitted` (the rich card replaces the grey line — approved).
- `TaskPane` loads/subscribes `executionsByTicket`, primes personas (`useAgentPersonas`), owns the exec-log
  panel; `WorkView` passes `deliverables` down. Reuses existing exported components — no new server endpoints.
- **CLI sessions excluded from run cards** — `buildStream` skips `source: 'cli'` executions. They're manual
  `claude` CLI sessions ingested at `sessionEnd` (`personaId:'cli'`, no stored events → log unavailable, garbage
  duration); already represented by their "CLI session summary" deliverable. Only Fleex SDK runs get a run card.
- Timeline visually confirmed by the user (run cards, deliverable cards, exec-log open); CLI-run fix applied after.

### Phase 2 (~3 days) — shell + diff/code

#### Phase 2a — Shell drawer + shell mode — **IMPLEMENTED, uncommitted, pending manual test**
New dir `components/work/shell/`:
- `shellLayout.ts` — pure layout reducer (`paneCount` / `splitRight` / `splitDown` / `closePane`);
  `1`→cols/rows→`three`→`grid`, close walks back. Unit-tested (`shellLayout.test.ts`, 12 cases).
- `shellSessions.ts` — pure `sessionsForTicket(groups, id)` (flattens `sessionGroups[].worktrees[]` by
  `ticketId ?? agentWorktree.ticketId`, oldest-first). Unit-tested (`shellSessions.test.ts`, 4 cases).
- `useShellSessions.ts` — that selector off `sessionStore` + a `newShell()` that calls the existing
  `api.openSessionFromTicket(ticketId)` (always creates a fresh ticket-linked shell; reuses the worktree;
  new session arrives via the `dashboard` WS refetch).
- `ShellPane.tsx` — one pane: header (dot·name·cwd, split-right/down, close ✕) + terminal or a `+ new
  shell` placeholder. Focus = 1px indigo ring (`--tint-indigo-solid`); claude dot `--tint-purple-solid`,
  shell dot `--tint-green-solid`. **Terminal uses the app's bottom-panel pattern** (local `ShellTerminal`:
  `relative` box + `xterm-container absolute inset-0` via `useTerminal`), NOT `<TerminalView>` (whose
  `xterm-container flex-1` let the xterm's height feed back into flex → fit() oscillation). Mirrors
  `SidebarBottomPanel`'s `SidebarTerminalView`.
- `ShellPanes.tsx` — CSS-grid per preset; pane i binds `sessions[activeShellIndex + i]`; renders exactly
  `paneCount(layout)` panes (off-screen sessions kept alive by `terminalManager`). Owns ⌘1-4 pane focus
  (only one grid mounts at a time). **Does NOT re-fit terminals itself** — `TerminalView`/`useTerminal`
  already owns a debounced `ResizeObserver` per container; an earlier second observer here caused a fit
  feedback loop and was removed. **Grid item is a `flex` wrapper + `ShellPane` is `flex-1`** — a block
  wrapper let the pane collapse to its 24px header, so the xterm fit to **1 row** and attached at `Nx1`.

**⚠️ THE bug that ate this session (root cause, fixed):** the pane had ~0 height → xterm attached at 1 row.
Because Fleex sessions are tmux (`window-size latest`, already correct — NOT a server bug), a 1-row client
drags the *shared* session to 1 row, collapsing any other client — including a terminal running Claude Code
inside that same session. Worse, each 1-row attach leaked: `tmux list-clients` showed **10 zombie `Nx1`
clients** accumulated over hot-reloads, all fighting over the session size. Fix = give panes real height
(above). Optional **defense-in-depth not yet applied**: clamp attach/resize cols·rows to a floor (≥2) in
`unified-ws.ts` (CLIENT_ATTACH/CLIENT_RESIZE) so no buggy client can ever collapse a shared session.
Leftover zombies from this session must be detached manually (`tmux detach-client -t <tty>` / kill stale
`tmux attach` procs).

**UX feedback round (session 3, uncommitted) — explicit pane/session model:**
- **Resizable drawer** — `workStore.shellHeight` (persisted, clamped 120–720) + top-edge drag handle
  (`ShellDrawer.tsx`, bottom edge fixed above the 26px status bar). Replaces the fixed `clamp()` height.
- **Fully explicit per-pane binding (no auto-fill)** — `workStore.shellPaneIds` + `bindShellPane(i, id|null)`
  resolved by pure `panesModel.resolvePanes` (pane i shows exactly `shellPaneIds[i]` if it still exists;
  no auto-fill; never the same session in two panes). Unit-tested (`panesModel.test.ts`, 7).
  `activeShellIndex` removed.
  - **Layout changes ONLY via the tab-bar preset buttons.** Per-pane split (`◫`/`⊟`) and "close pane" were
    removed; `shellLayout.ts` now exports only `paneCount` (the split/close reducer + its tests deleted).
  - **Pane ✕ = UNBIND** the session (pane goes empty; session keeps running) — not close-pane.
  - **Pane title = dropdown** (`ShellPane` BindList) to switch the binding: any unshown session, or `+ new
    shell`. **A tab click never binds a pane.**
  - **Empty pane** = a centred "Empty pane" menu with the same BindList (bind unshown / new shell).
- **Tab bar is now a session roster only** — double-click a tab → inline rename (`api.renameSession`);
  hover ✕ → `api.killSession` + optimistic `removeSession`; `+` opens an **unbound** shell (lands in the
  roster, bind it from a pane). No tab-click binding, no hide control.
- **De-emoji** — the mode toggle uses inline SVG icons (chat bubble / expand), no 💬/⤢. `onHide` removed
  throughout (drawer hidden from nav Shell button; shell mode exits via "Back to chat").
- **Keyboard (owned by `ShellSurface`)** — `⌘1-4` focus pane N (browser reserves these; reliable only in
  the desktop app). **`⌘⇧←/→` is layout-dependent**: in a split it **moves focus between panes**
  (TL→TR→BL→BR, matching pane index order); with a single pane it **cycles that pane's session** (nowhere
  else to move focus). Global `useKeyboardShortcuts` defers all three `⌘⇧←/→` branches to Work
  (`activePanel !== 'work'`), like `⌘⇧↑/↓`.
- **Tab click shows the session in the focused pane** (`onSelectTab` → `bindShellPane(focusedPane, id)`);
  double-click still renames, ✕ still kills. **Focus outline** shown only in splits (`showFocus = count > 1`)
  as a `pointer-events-none absolute inset-0 z-10 border-2` indigo overlay ABOVE the terminal — an inset
  ring on the pane is painted over by the xterm's absolute-inset canvas, so it was invisible.
- Verified: tsc clean · 778 tests (7 new panesModel; 11 obsolete layout-transition tests removed) · palette
  clean. Still uncommitted.
- `ShellTabBar.tsx` — `>_` · tab per session · `+` · layout presets · `⤢ Shell mode`/`💬 Back to chat` · `▾`.
- `ShellSurface.tsx` — tab bar + panes; shared by both hosts.

Wiring: `WorkView.tsx` renders the drawer band (`clamp(180px,38vh,300px)`, below the middle row,
`shellOpen && !shellMode`) and swaps `ShellSurface` for `TaskPane` in the center when `shellMode`.
`ToolStrip.tsx` gained a bottom **Shell** `>_` button (toggles `shellOpen`, highlighted when open/mode).
`keyboard.ts` gained ⌘J (drawer) + ⌘⇧J (mode); ⌘1-4 lives in `ShellPanes`. No `workStore` changes needed
(state was pre-scaffolded). Verified: tsc clean · 782 tests (16 new) · palette clean. **Not committed —
user testing behaviour first.** No new server endpoints in 2a.

Open design choices (revisit after test): close on a single pane is a no-op (use ▾/⌘J to hide);
`activeShellIndex` is not clamped if sessions are killed below it (stale index → empty panes, not broken).

#### Phase 2b — Diff & Code panels (NOT started)
- Need **2 new server read endpoints**: `GET /api/worktrees/:id/diff` and `GET /api/worktrees/:id/tree`
  (see `handoff/DATA_MODEL.md` § Phase 2). Add `git diff` patch-text + `git status --porcelain` +
  `git ls-tree` to `GitPort` + `git-cli.adapter.ts` (none exist yet), route modelled on
  `repositories.routes.ts` (resolve `barePath`, `hostFs.exists`, `container.git.*`), register in `main.ts`.
- `RightPanel.tsx` already has `diff`/`code` TITLES; add the two bodies + their `ToolStrip` entries
  (still hidden). Poll every 5s while open or on `agent_event` Edit/Write tool_result.

### Phase 3 (~1-2 weeks, server) — assistant ⇄ agent threads
- `agent_thread` entity, ticket-scoped assistant runs, `delegate_to_persona` tool, WS thread events,
  Threads panel + delegation cards. See `handoff/DATA_MODEL.md` § Phase 3.

## Key facts / gotchas (learned during impl)

- `Ticket` has **no `size`** field; number is `displayId`; `type` nullable; boards ARE campaigns.
- Status is lowercase: `backlog|todo|doing|reviewing|done|cancelled`. Priority `none|low|medium|high`.
- Worktrees/repos come from `ticket.links` type `repository` (`ref="org/name"`, multi-repo) — NOT the
  single `worktree` link, NOT sessionGroups. PR from `github_pr` link (`ref="org/name#num"`);
  diff stats (+add/−del) come from `WorktreeSessionGroup.diffStats`.
- No `amber` tint → use `yellow`. Panels use `--theme-bg-surface` (no `--theme-bg-primary`); accent tint
  is `--theme-accent-muted`; accent label text `--theme-accent-fg`. All tint vars injected at runtime by
  `lib/themes.ts` (not in index.css).
- Markdown: reuse `components/scratchpad/MarkdownRenderer` (needs no-op `onToggleCheckbox`).
- Mention autocomplete: `useMentionAutocomplete` + `MentionMenu` + `useAllMentionOptions`; native
  `onChange` must call both value-setter AND `onScan`; `onKeyDown` calls `mentionAc.onKeyDown` first;
  wrap in `relative`; prime stores (`loadPanels`/`loadSkills`/workflow `refresh`).
- Reusable pickers `TypePickerPopover`/`PriorityPickerPopover` are ticket-bound; the new-task ones
  (`DraftTypePicker`/`DraftPriorityPicker`) are value+onChange clones.
- Tests to keep green: `selectors.test.ts` (partition/suggestions/inline parser), `RouterSync.test.ts` (/work).

## Reference

Handoff (worktree root, not in git): `../handoff/{README,SPEC,DATA_MODEL,IMPLEMENTATION_PLAN,DESIGN_TOKENS}.md`,
`../handoff/prototype/Fleex-Work-Prototype.dc.html`, `../handoff/screenshots/`.
