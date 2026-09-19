# SPEC — Fleex « Work » view

Goal: start any task (code or not, framed or not) by writing, then let agents do it — through conversation, workflows or primitives — **without ever leaving one screen**. Remove friction: the ticket, board, worktrees are side effects, created silently and undoable.

Reference: `prototype/Fleex-Work-Prototype.dc.html`. Screenshots in `screenshots/`.

---

## 1. Layout (desktop only — mobile keeps `MobileApp` untouched)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ TOP BAR (36px, full width)                                                   │
├────┬──────────────┬──────────────────────────────┬──────────────┬───────────┤
│Nav │ QUEUE        │ TASK (center)                │ RIGHT PANEL  │ TOOL STRIP│
│48px│ 300px        │ minmax(0,1fr)                │ 296/400px    │ 60px      │
│    │              │                              │ (toggle)     │           │
│    ├──────────────┴──────────────────────────────┴──────────────┴───────────┤
│    │ BOTTOM SHELL DRAWER (⌘J) — full width minus nav, clamp(180px,38vh,300px)│
├────┴─────────────────────────────────────────────────────────────────────────┤
│ STATUS BAR (26px, full width)                                                │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Min width 1180px, min height 560px; below that the page scrolls rather than squashes.
- The Fleex nav (`NavSidebar`) stays. When `activePanel === 'work'`, the existing `ContentPanel` column is hidden (like `tickets` / `list-focus`), and `MainPanel` renders `<WorkView />` which owns everything right of the nav, top bar and status bar included.
- Right panel is one-at-a-time (JetBrains tool-window model). Tool strip toggles it; clicking the active tool closes it.

## 2. Top bar

Left → right: Fleex logo + name · ⌘K search field (opens existing `CommandPalette`) · summary text `N tasks · N running · N need you` · **Sync overlay** (existing `OverlaySyncButton`, scoped to the selected task's first worktree) · `PINNED` label + pinned actions (existing pinned-icons settings + workspace actions from `WorktreeHeader`: Cursor, Finder, localhost, Logs…) · notifications bell (existing `NotificationNavItem` popover) · avatar.

## 3. Queue (left, 300px)

Header: `QUEUE <count>` + primary button `+ New` (⌥N).

Filter chips: `All` + one chip per board (boards = campaigns: Odys, Leadership, Fleex, Audit…). **Grouping is by board, never by repo** (tickets can be multi-repo or repo-less).

Three sections, in this order, each with a count. A ticket appears in exactly one:

| Section | Rule | Row content |
|---|---|---|
| **NEEDS YOU** (amber) | `activity === 'waiting'` (agent question, gate, panel conclusion) | Title, board · the pending question text (`<agent> asks: …`) · **inline answer buttons** (options of the pending question) + `Reply…` |
| **RUNNING** (indigo) | `activity === 'running'` | Title, board · activity label (`builder · running tests`, `workflow · PR review 2/4`) · **progress bar** (3px). Progress = workflow step/total when known; otherwise indeterminate animation |
| **IDLE** (grey) | everything else in Doing/Reviewing | Title · right-aligned `review` or `idle <age>` |

Rows: selected row = indigo tint + 2px left border. Clicking selects the task (center + right panel follow). Answering inline does **not** change selection.

Footer: `Done this week N` · `Backlog N ›` (opens Kanban at that board, existing route).

## 4. Task header (center, 44px)

Title (truncates) · `#num` mono · spacer · `>_ Shell <count>` (toggles drawer, ⌘J) · `⤢ Shell mode` / `💬 Back to chat` (⌘⇧J) · `⋯` menu (Open in Kanban, Open in Sessions, Archive…).

## 5. Conversation (center)

One chronological stream mixing:

- **User message** — right-aligned indigo bubble.
- **Assistant message** — avatar `◆` indigo, name `Assistant`. May carry:
  - a **run block** (mono lines with ✓/● marks — lint, build, test counts),
  - an **inline question card** (amber border): label `WAITING FOR YOUR CHOICE`, question text, option buttons (first = primary). Once answered: grey, label `ANSWERED · <choice>`, options disabled, chosen one green.
- **Agent message** — avatar `⌬` purple, persona name (legacy: direct `@agent:` replies still render this way).
- **Event line** — small grey line, ✓ prefix: `Ticket #550 created on Odys — board inferred from repo [change]`, `Worktree odys-front · feat/550-ai-sidebar created`, `Ticket moved to Reviewing`, `Overlay synced · 3 files…`. Some carry an action link (`change`, `open shell`).
- **Date divider** — `today`, `3 days ago`.
- **Delegation card** (see § 9) — `Assistant ⇄ The Builder`.
- **Typing indicator** — `<persona> is working…` while running.

Composer footer:
- **NEXT strip** (indigo border) when the assistant has a proposed next step: `NEXT · <text>` · `Do it ⌘⏎` · `Dismiss`.
- **SUGGESTED chips**: contextual, max ~5, in order: `⇄ See with the PM`, `⇄ See with the dev`, `▷ Run workflow · PR review` (when PR exists and Doing), `→ Move to Reviewing`, `✓ Mark done` (when Reviewing), `⎇ Attach <repo>` (suggested repos), `⦿ Convene a panel` (Think type), `⌬ Ask reviewer persona`.
- Textarea with placeholder `Reply, or @ to bring in agents, skills, panels, workflows, tickets…`. Reuse the existing mention autocomplete (`useMentionAutocomplete`, `MentionMenu`). Footer: attach · `Mode Edit ⇧⇥` · `Auto (persona) ▾` · `Opus ▾` · `⇧⏎ newline` · send.
- Enter sends. Natural-language delegation is detected: `vois avec le PM`, `demande au dev`, `see with the reviewer`, `@agent:builder` → opens a delegation (§ 9).

## 6. Right panel + tool strip

Tool strip (60px, icon + label under it): **Context** `◫` · **Threads** `⇄` (amber dot when a thread is running) · **Diff** `±` (amber dot when the branch has changes) · **Code** `‹›` · **Delivs** `▤` · bottom: **Shell** `>_`.

### 6.1 Context (296px) — the ticket's meta, all editable in place
- STATUS: status chip (click cycles Todo → Doing → Reviewing → Done; emits an event line) · `Type · Size` chip.
- BOARD: one chip per board, current highlighted; click moves the ticket (event line).
- AGENTS: persona rows with state (`running` / `waiting for you` / `idle`) · `+ add persona or panel`.
- WORKTREES: `⎇ repo · branch` rows with `✕` **detach** (kept on disk, event line) · `+ <repo> · attach` suggestions (suggested = repos mentioned in the thread but not attached).
- PULL REQUEST: green card `owner/repo#N · checks · +adds −dels`, click → Diff panel.
- DELIVERABLES · N: first 3 with kind badge (CODE, FD, NOTE, TEST, MEMO…), click → Delivs panel.
- SESSIONS: `id · title` + meta (context %, idle), click → focuses that shell in the drawer.
- Footer: `$cost · N sessions · age`.

### 6.2 Threads (400px) — agent-to-agent conversations (§ 9)
Top: list of threads for this ticket (dot = state, agent, brief, age). Below: selected thread with header `◆ ⇄ ⌬ <agent>` + state; tabs **Conversation** | **Agent SDK stream**; cost mono right.
- Conversation: `CONTEXT FORWARDED` chips (ticket, worktrees, PR, deliverables), turns (Assistant ◆ / agent ⌬ / You), tool calls listed under agent turns (`› Read …`, `› Bash …`), `<agent> is working…`, then `Concluded · summary posted back to the main thread`. Footer: textarea `Step into the thread…` (Enter posts as You) + `Conclude now & bring back ↩` while running.
- Agent SDK stream: dark mono log `time · kind · text` (system.init, user, turn_start, tool_use · Name, tool_result, text, message_stop, result). Footer: `exec <id>` · `Open in Execution log` · `Terminate`.

### 6.3 Diff (296px)
Header `⎇ repo · branch` + `+a −d · N files`. Unified diff, file headers, hunk headers, add/del tinted lines. Footer: `✓ <tests · lint · build>` · `Open in editor`. Empty state: `No changes yet on this task.` Works with or without a PR (it's the working branch diff vs base).

### 6.4 Code (296px)
Repo chips · file tree (changed files bold + amber dot) · buttons `Open in VS Code ⌘⇧O` (black) and `Open in browser (code-server)`.

### 6.5 Delivs (296px)
Cards: kind badge · title · meta. Click opens the existing deliverable overlay. Empty: `Nothing delivered yet.`

## 7. Shell

Two modes, same tabs and panes:

**Drawer** (⌘J): bottom, full width minus nav rail, height `clamp(180px, 38vh, 300px)`, dark. Tab bar: `>_` · one tab per session (`● claude · Opus ff0cd9`, `● zsh a41c02`; purple dot = claude, green = shell) · `+` new shell · `LAYOUT` presets · `⤢ Shell mode` · `⌘J` · `▾` hide.

**Shell mode** (⌘⇧J): the shell replaces the conversation in the center; queue and right panel stay. Same tab bar; hint `⌘1-4 focus · ⌘⇧J back to chat`.

**Layout presets** (both modes): `▭` single · `◫` split right (vertical divider) · `⊟` split down (horizontal divider) · `◨` one + two stacked · `⊞` 2×2. Each pane header: `title · path` · `◫` split right · `⊟` split down · `✕` close. Split from single → cols/rows; from cols/rows → three; from three → grid. Close walks back. Focused pane = 1px indigo outline; ⌘1-4 focus pane N.

Panes bind to the ticket's sessions in order from the active one; empty panes show `new shell` and create one on click (cwd = first worktree).

## 8. New task (⌥N or `+ New`)

Replaces the center; queue shows a dashed `New task · draft · not yet a ticket` row on top. No form — one card:
- Textarea `Describe the task. Code or not, framed or not.` (autofocus)
- `REPOS` chips (multi) · `BOARD` chips (single, default none → `Inbox`) · `TYPE` Build/Think/Fix · `SIZE` S/M/L
- Footer: attach · `Auto (persona) ▾` · `Opus ▾` · hint `⏎ starts · ticket #N on <board>` · **Start ⏎** (disabled until text).
- `Cancel esc`.

On Start, silently and in this order, each as an event line in the new task's stream: create ticket (title = first sentence ≤70 chars, description = full text, board, type, size, status Doing) → create one worktree per selected repo (`feat/<num>-<slug>`) → post the text as the first user message → assistant replies with framing + inline question (`Hand to builder` / `Frame first` for Build; `Convene panel` / `Think together` for Think). Selection jumps to the new task; right panel = Context.

## 9. Delegation (assistant ⇄ agent)

Triggered by suggestion chips, natural language, or `@agent:x` in the composer.

1. Assistant posts `Je vois ça avec <agent> — je lui transmets le contexte du ticket.`
2. A **delegation card** appears: `◆ Assistant ⇄ ⌬ <agent>` · state (`in progress` pulsing / `waiting for you` / `concluded`) · brief · `FORWARDED` chips · footer `N exchanges · "<last line>" · Open thread ›`. Click → Threads panel on that thread.
3. Queue row goes RUNNING with `<persona> · in thread with assistant`. If the ticket was already running something, that activity is restored on conclusion.
4. Conclusion (agent's last turn, or user `Conclude now`): card → `concluded`; assistant posts `Retour de <agent> : <summary>` in the main stream, optionally with an inline question (`Push it` / `Hold` for builder).

## 10. Status bar (26px)

Left: breadcrumb `Board › #num Title › ⎇ repo · branch` (each segment clickable: filter queue / open Context / open Diff). Right, separated by hairlines, each clickable: agent state with dot (`builder · running tests · 60%`, `builder · waiting for you`, `assistant · idle`) → Context · `repo#PR · checks ✓` → Diff · `N worktrees` → Context · `N shells` → toggle drawer · ticket status → cycles · `$cost · Opus`.

## 11. Keyboard

| Keys | Action |
|---|---|
| ⌥N | New task |
| Esc | Cancel new task |
| ⏎ / ⇧⏎ | Send / newline (composer, new-task textarea, thread textarea) |
| ⌘⏎ | Run NEXT |
| ⌘J | Toggle shell drawer |
| ⌘⇧J | Toggle shell mode |
| ⌘1–4 | Focus shell pane (when drawer/mode open) |
| ⌘K | Command palette (existing) |
| 1 / 2 | Answer first/second option of the focused inline question (nice-to-have) |

## 12. States to handle

- No tasks: queue empty state with `+ New`; center shows the New task card directly.
- Task with no repo: Worktrees `No repo attached — that's fine.`; Diff/Code empty states; Shell creates a `~` shell.
- Task with several running things: activity label shows the most recent; progress from the workflow if any.
- Panel closed: center takes the width; tool strip stays.
- Narrow (<1180px): horizontal scroll, never overlap.
