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
- Shell drawer (⌘J) + shell mode (⌘⇧J) with split layouts, binding ticket sessions to `TerminalView`
  panes. State already scaffolded in `workStore` (`shellOpen/shellMode/shellLayout/activeShellIndex`).
- Diff & Code panels — need **2 new server read endpoints**: `GET /api/worktrees/:id/diff` and
  `GET /api/worktrees/:id/tree` (see `handoff/DATA_MODEL.md` § Phase 2). Tool-strip tools for
  Diff/Code/Shell are currently hidden.

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
