# Work view — implementation status

Single-screen "Work" ergonomics (handoff package at `../handoff/`, root of the worktree).
Branch `ticket/b12c65-focus-view` · PR **#278** (base `main`). This doc is the resume
point across context resets — update it as work progresses.

## Where we are

**Phases 0, 1, 2a AND 2b are DONE, committed and pushed.** → **NEXT: Phase 3 (assistant ⇄ agent threads).**
See "Phase 2b" below (sessions 4–9 log) for what was built and the deferred items.

- Phase 0 (wiring) + Phase 1 (core screen): commit `308d11ac` + 9 feedback rounds.
- **Phase 2a (shell drawer + shell mode + split panes): commits `13e899d2` and `db27fa1c`.** Full detail in
  the "Phase 2 → Phase 2a" section below. Shell mode now opens via the top-bar **Chat/Code/Shell ModeSwitcher**
  (added in 2b); the bottom tool-strip Shell button + ⌘J open the drawer.
- **Phase 2b (Diff panel + full Code editor): commit `c94fed78`, pushed to `origin/ticket/b12c65-focus-view`
  (PR #278).** Diff panel (collapsible + filter + combined multi-repo) and Code mode (tree + tabs + Monaco
  edit/save + Edit/Diff toggle + diff gutter + create/delete + persistent tabs via `codeEditorStore`). Server
  endpoints under `/api/worktrees/:id` (diff/tree/file get·base·put·create·delete) + new `GitPort` methods.

Working tree clean; branch in sync with origin. Verified green at commit: **server tsc + 1307 tests**;
**web tsc + 778 tests**; `check-raw-palette.mjs` clean.

Run checks per package: `../../node_modules/.bin/vitest run`; `../../node_modules/.bin/tsc --noEmit -p .`;
web palette `node ../../scripts/check-raw-palette.mjs`. Rebuild shared after a shared type change:
`(cd packages/shared && ../../node_modules/.bin/tsc)`. (deps installed via `bun install` at repo root.)

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

### Notes panel (scratchpads in the right sidebar) — DONE, committed `aeee69d2`, pushed
Adds a **Notes** tool to the right sidebar (alongside Context/Diff/Code/Delivs): a Global scratchpad
tab + one tab per repo attached to the ticket — the session-view ergonomics the user liked
(`SidebarTopPanel`). No backend or scratchpad-store change: reuses `scratchpadStore` (keys
`__global__` | `org/name`, per-repo endpoints) + embeddable `ScratchpadContent` (`compact`).
- `panel/scratchTabs.ts` — pure tab model (`scratchTabs` Global+per-repo dedup, `resolveActiveScratchTab`
  persisted→Global fallback). Unit-tested (`scratchTabs.test.ts`, 8 cases).
- `panel/ScratchpadTabsPanel.tsx` — resolves the ticket's `repository` links (via `ticketStore`, same
  source as `ContextPanel`, so tabs track attach/detach live), renders the tab strip +
  `ScratchpadContent key={activeKey}`. Active tab remembered per ticket.
- `workStore.ts` — `'scratch'` added to `RightPanel`; new persisted `activeScratchTabByTicket` map +
  `setActiveScratchTab`.
- `ToolStrip.tsx` — "Notes" button (notebook icon). `RightPanel.tsx` — `NOTES` title + render.
- Verified: web tsc clean · 786 tests (8 new) · palette clean. User-confirmed, committed + pushed.

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

#### Phase 2b — Diff & Code panels — **IMPLEMENTED, uncommitted, pending manual UI test**

**What was built (session 4):**
- **Shared types** (`packages/shared/src/types/worktree-diff.ts`, exported from `index.ts`): `DiffLine`/
  `DiffHunk`/`DiffFile`/`WorktreeDiff` (+ `path`, `truncated?`) and `FileTreeNode`/`WorktreeTree` (+ `path`).
- **Server pure helpers (TDD)** in `packages/server/src/domain/services/`:
  - `diff-parser.ts` `parseUnifiedDiff(patch)` → `DiffFile[]`; tolerant line-by-line parse (added `--- /dev/null`,
    deleted `+++ /dev/null`, binary, `\ No newline`, spaced paths, truncated tail). 8 tests.
  - `file-tree.ts` `parseStatusPorcelain(out)` (+ rename dest) & `buildFileTree(tracked, changed, untracked, depth)`
    (nests, dirs-first, propagates `changed` to ancestors, prunes to depth, de-dups). 8 tests.
- **GitPort + adapter** (`git.port.ts` / `git-cli.adapter.ts`): `getDiffPatch(worktreePath, base?)` = `git diff`
  against `merge-base(base, HEAD)` (captures committed+staged+unstaged in ONE command; two-dot fallback if
  merge-base fails — strictly a superset of the SPEC's "base...HEAD + unstaged, merged", no patch-merging needed);
  `listTrackedFiles` (`ls-tree -r --name-only HEAD`); `getStatusPorcelain`. Fake-exec adapter tests assert the git
  args (5 tests). `FakeGitPort` (tests/helpers/fakes.ts) got the 3 stubs.
- **Routes** `worktree-diff.routes.ts` (registered app-level in `main.ts`, full `/api/...` paths like
  `repositories.routes.ts`): `GET /api/worktrees/:id/diff` and `/tree?depth=` — **`:id` is the TICKET id**;
  worktree resolved from the ticket's `worktree` link (`ref`=checkout path, `label`=branch), repo from the
  `repository` link. No worktree / gone checkout → empty result. Diff caps raw patch at 400 KB → `truncated`.
  `bareCloneManager.fetch` refreshes origin refs (shared object store) before resolving `base = origin/<default>`.
- **Client**: `api.ts` `fetchWorktreeDiff(ticketId)` / `fetchWorktreeTree(ticketId, depth=3)` (paths `/worktrees/:id/…`,
  `API_URL=/api`). `panel/DiffPanel.tsx` (summary header ⎇branch +a −d · N files, per-file headers, blue hunk
  headers, green/red tinted lines via `--tint-*`, "Open in editor" `vscode://file/<path>`, 5s poll, "No changes
  yet on this task." empty). `panel/CodePanel.tsx` (repo chip, recursive collapsible tree, changed files bold +
  yellow dot with dot propagated to dirs, "Open in VS Code", 5s poll). Wired into `RightPanel.tsx`; `ToolStrip.tsx`
  got `± Diff` (yellow dot when `task.changedLines > 0`) + `‹› Code` entries. `WorkTask.changedLines` added
  (`types.ts` + `useWorkQueue.ts`, from `diffStatsByTicket`, PR-independent).
- Verified green: server tsc clean · **1298 server tests** (21 new) · web tsc clean · **778 web tests** · palette
  ratchet 0. Real-git smoke test on this worktree confirmed the adapter's `git` commands emit exactly the formats
  the parser tests cover. **Not committed — user testing UI behaviour first** (like 2a).
- **Deferred (not blocking):** poll-only refresh (no `agent_event` Edit/Write hook yet); code-server "Open in
  browser" button (no code-server URL config); the `unified-ws.ts` attach/resize floor-clamp defense-in-depth.

**Session 5 — feedback round after manual test (uncommitted):** real use on this PR (68 files / 6k LoC) exposed
several issues, all fixed:
- **Panel too narrow** — `RIGHT_PANEL_MAX` 560→1200 (drag also runtime-capped to `innerWidth − 360` in
  `RightPanel.tsx` so it can't engulf the center). Diff/Code now get real width.
- **Big-diff UX (chosen: collapsible + filter)** — `DiffPanel` rewritten: files **collapsed by default**
  (path · +N/−N header, click to expand hunks), a **path filter** box + **expand/collapse-all**. Navigable at 68 files.
- **Code folder-expand was a no-op (BUG)** — root cause: tree was fetched at `depth=3`, so dirs at the boundary
  came back with `children` pruned → nothing to render on expand. Fix: server sends the **full tree**
  (`TREE_DEPTH=100`, effectively unlimited for git-tracked files); `buildFileTree`/depth param unchanged. Dirs with
  changes **auto-expand** (children now present) so changed files are visible; others collapse.
- **Click a file to open it (chosen: in-app viewer)** — new `GET /api/worktrees/:id/file?repo=&path=` (reads via
  `hostFs`, path-contained to the worktree — rejects `..`/absolute, verified; 500 KB cap; NUL-byte → `binary`).
  New `panel/FileViewer.tsx` floating overlay (line numbers, Esc/backdrop close, "Open in VS Code"). `CodePanel`
  file rows open it.
- **Multi-repo (chosen: combined / all repos stacked)** — API reshaped to per-repo lists: `WorktreeDiff.repos:
  RepoDiff[]`, `WorktreeTree.repos: RepoTree[]` (+ `WorktreeFile`). Route `resolveWorktrees` now returns **every**
  attached repo whose checkout exists (repository links → worktree-link path matched by repo name, else
  `workspaceRepoPath(buildTicketWorkspaceId(...), name)`). Diff prefixes each file with its repo when >1; Code shows
  a collapsible group per repo. Single-repo renders flat as before.
- Dropped the Diff "Open in editor" footer (ambiguous under combined multi-repo; editor-open lives on each Code repo
  group + the FileViewer). Verified green: server tsc · 1298 server tests · web tsc · 778 web tests · palette 0.

**Session 6 — feedback round 2 + full Code editor (uncommitted):**
- **Dots missing though a diff exists (BUG)** — tree "changed" came from `git status --porcelain` (uncommitted only);
  the diff is vs merge-base (committed too). Fix: new `git.getChangedFiles(wt, base)` (`git diff --name-only
  <merge-base>`, two-dot fallback, TDD'd); tree route uses it for `changed`, porcelain now only supplies untracked.
  Dots now match the Diff.
- **"Open in VS Code" wrong colour** — was `--theme-accent-fg` (the on-accent foreground = white/black). Now
  `--theme-accent` (correct for an accent text link on a surface).
- **Floating viewer overflowed** — capped at `max-h-[85vh]`.
- **Full Code editor (chosen: full in-app editor)** — replaced the read-only modal with a center-takeover **Code
  mode** (mirrors Shell mode; `workStore.codeMode`, mutually exclusive with `shellMode`; toolstrip Code button
  toggles it). `components/work/panel/`:
  - `CodeEditor.tsx` — left file-tree rail (`FileTree.tsx`, extracted; per-repo groups, changed dots, active
    highlight) + editor tabs (open/close, dirty dot) + Monaco. Tree polls 5s; files load on demand; "Back to chat" exits.
  - `WorktreeMonaco.tsx` — lazy `@monaco-editor/react` (types derived from `OnMount`, no direct `monaco-editor`
    import). **Syntax highlighting** (language by extension), theme inferred from `--theme-bg-base` luminance (vs/vs-dark),
    **diff gutter** via a decorations collection on `changedLines` (`.wt-diff-gutter` in index.css → `--tint-green-solid`),
    ⌘S save.
  - **Editing + save** — new `PUT /api/worktrees/:id/file {repo,path,content}` (path-contained, existing files only)
    + `api.saveWorktreeFile`. File read now returns `changedLines` (new `git.getFileDiffPatch` + pure
    `changedLineNumbers`, TDD'd) for the gutter. Fixed a NUL-byte literal that JSON transport had baked into the
    route source (now `String.fromCharCode(0)`).
  - Deleted the old `CodePanel.tsx` + `FileViewer.tsx`; removed the `code` right-panel branch (Code is a mode now).
- Verified green: server tsc · **1305 server tests** · web tsc · **778 web tests** · palette 0. Still uncommitted.
- **Deferred:** per-tab Monaco undo history (tabs remount on switch); gutter reflects diff-at-open (not live after edits);
  new-file creation from the tree (save overwrites existing files only).

**Session 7 — feedback round 3 (uncommitted):**
- **Unified mode switcher** — the scattered per-surface toggles (TaskHeader `>_ Shell` top-right, CodeEditor "Back to
  chat" top-left, ShellTabBar "Back to chat" top-right) were inconsistent. New `ModeSwitcher.tsx` (Chat / Code / Shell
  segmented) in the always-visible `WorkTopBar` (shown in task view). Removed the Shell button from `TaskHeader` and the
  "Back to chat" from `CodeEditor`; `ShellTabBar`'s toggle now only shows in the drawer as "Shell mode" (expand), not a
  back button in shell mode. Chat = both modes off; Code/Shell mutually exclusive (store setters already enforce it).
- **Open tabs persist** — moved the editor's tabs/active/content out of component state into `stores/codeEditorStore.ts`
  (per ticket). Tabs + active are persisted to `localStorage['fleex_code_editor']`; content is kept in memory (refetched
  after a reload). Leaving Code mode for chat/shell and returning keeps the open tabs (and unsaved edits within a session).
- **Create / delete files** — new `POST /api/worktrees/:id/file/create {repo,path,type}` (mkdir parents for files,
  path-contained, 409 if exists) and `DELETE /api/worktrees/:id/file {repo,path}` (path-contained, refuses the worktree
  root) + `api.createWorktreeFile` / `api.deleteWorktreeFile`. `FileTree` got a per-repo **＋ new-file** action (inline
  path input → create + open) and a per-file **hover trash → inline delete/cancel** confirm.
- **Removed the "VS Code" button** next to the repo name in the tree (kept the per-file "Open in VS Code" in the editor footer).
- Verified green: server tsc · 1305 server tests · web tsc · 778 web tests · palette 0. Still uncommitted.
- **Deferred:** folder create/delete (files only for now); a mode keyboard shortcut for Code (Shell keeps ⌘⇧J).

**Sessions 8–9 — Code editor chrome (uncommitted; all code in place & green):**
- **Inline diff view** — Edit/Diff toggle swaps Monaco for a read-only side-by-side `DiffEditor`
  (`WorktreeDiffEditor.tsx`, lazy). Base content via `GET /api/worktrees/:id/file/base` + adapter
  `git.getFileBaseContent` (`git show <merge-base>:<path>`, '' for new files; TDD'd) + `api.fetchWorktreeFileBase`.
  Shared Monaco helpers in `monacoUtils.ts`.
- **Code layout** — tree spans full height on the left; tabs bar only above the editor (was full-width). Structure:
  outer col → top action bar → row(tree · [tabs + editor]).
- **Top action bar**: `⎇ branch` (left) · Edit/Diff toggle · **Save** · refresh tree (right). **Footer**: active-file
  **breadcrumb** (left) · read-only/truncated notes (right). Removed footer Save / "Open in VS Code" / bottom-right path.
- Verified green: server tsc · **1307 server tests** · web tsc · **778 web tests** · palette 0. Phase 2b
  feature-complete pending final sign-off + commit.

<details><summary>Original Phase 2b spec (kept for reference)</summary>
Goal (SPEC §6.3/6.4): a **Diff** panel (unified working-branch diff vs base, add/del tinted, footer "Open
in editor", empty = "No changes yet on this task.") and a **Code** panel (repo chips · file tree, changed
files bold + dot · "Open in VS Code" / code-server). Both are ticket-scoped, read-only, poll every ~5s
while open (or refresh on an `agent_event` Edit/Write tool_result).

**Server (2 new read endpoints — DATA_MODEL.md § Phase 2):**
- `GET /api/worktrees/:id/diff` → `{ base, head, files: [{ path, additions, deletions, hunks:[{ header,
  lines:[{ kind:'ctx'|'add'|'del', text }] }] }], truncated? }`. `git diff <base>...HEAD` + unstaged
  `git diff`, merged; base = default branch; cap ~400 KB → `truncated:true`.
- `GET /api/worktrees/:id/tree?depth=3` → nested `{ name, path, kind:'dir'|'file', changed? }[]`;
  `changed` from `git status --porcelain`.
- **How to build it (verified in the tree during 2a):**
  - Add methods to `GitPort` (`packages/server/src/application/ports/git.port.ts`) + implement in
    `git-cli.adapter.ts` (`infrastructure/adapters/`). NONE of `git diff` patch-text / `git status
    --porcelain` / `git ls-tree` exist yet — only `getDiffStats`/`getDiffSummary`/`listWorktrees`. Copy
    their shape: everything goes through the injected `ExecFn` (`this.execFn('git',[...],{cwd,timeout})`),
    base default `origin/${getDefaultBranch}`.
  - Route module modelled on `repositories.routes.ts` (see its `GET …/diff-stats` at ~L307: resolve path
    via `container.resolver`, `container.hostFs.exists`, `container.bareCloneManager.fetch`, then
    `container.git.*`). A ticket's worktree path/branch come from its `worktree` link (`agent-worktrees.routes.ts`
    `GET /tickets/:id/worktree` → `{ path, branch }`); bare path via `RepoPathResolver.barePath(org,name)`,
    checkout via `workspaceRepoPath(workspaceId, repoName)`. Register the module in `packages/server/src/main.ts`.
  - **Fleex migration/RLS rules apply** (see `fleex/CLAUDE.md`) — but these are read-only, no new tables.
- **Optional defense-in-depth (flagged, not done):** clamp attach/resize cols·rows to a floor (≥2) in
  `unified-ws.ts` `CLIENT_ATTACH`/`CLIENT_RESIZE` so no buggy client can collapse a shared tmux session
  (root cause of the 2a "1-row attach" saga).

**Client:**
- `api.ts`: add `fetchWorktreeDiff` / `fetchWorktreeTree` (bare `async function` calling `request<T>`,
  templates: `fetchDiffStats`/`fetchDefaultBranch` ~L134-152). Types in `@fleex/shared`.
- `RightPanel.tsx` already has `diff`/`code` in `TITLES` — add the two panel bodies there
  (`components/work/panel/`, e.g. `DiffPanel.tsx` / `CodePanel.tsx`). Add their **`ToolStrip` entries**
  (`± Diff` with a dot when the branch has changes, `‹› Code`) — `ToolStrip.tsx` currently ships only
  Context/Delivs + the bottom Shell button.
- Reuse `lib/tints.ts` for add/del tinting (green/red `--tint-*`), never raw palette classes
  (`check-raw-palette.mjs` ratchet at 0). TDD the pure diff-parse/tree-shape helpers like 2a did
  (`shellLayout`/`panesModel` pattern).
- Diff stats (+add/−del) for the header already exist per ticket via `WorktreeSessionGroup.diffStats`
  (`useWorkQueue.diffStatsByTicket`).

</details>

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
