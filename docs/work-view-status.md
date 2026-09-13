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
- NEXT strip (assistant proposal / client rule) — component referenced in SPEC §5, not built.
- Agent-personas section in Context (SPEC §6.1 AGENTS).
- Event lines in the stream from the domain event log (SPEC §5) — currently only comments + description.
- Top bar: pinned actions + `OverlaySyncButton` (SPEC §2) — top bar is minimal (brand + ⌘K + summary).
- New task: create actual git worktrees (`ticketStore.openSessionFromTicket`) + seed first message
  — currently only attaches `repository` links.
- PR state colour via `api.fetchPRStates` (PrBadge currently hardcodes `state:'open'`).
- Comment stream live-updates via WS (currently refetch on select + after post).

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
