# DATA_MODEL — what the Work view reads and writes

Everything below maps prototype concepts to **existing** Fleex code (`packages/web/src`, `packages/server/src`, `packages/shared`). Verify names against the tree at implementation time; paths are from `main` on 2026-09-13.

## Existing sources (read)

| Prototype concept | Fleex source |
|---|---|
| Tasks in the queue | `ticketStore` tickets with status Doing/Reviewing across all boards (+ Todo optional). Boards = `ticketStore` boards. |
| Activity (needs you / running / idle), since, detail, runningExecutionId, cost | `ticketActivityStore` (`activityByTicket: idle\|running\|waiting`, `detailByTicket`, `sinceByTicket`, `runningExecutionIdByTicket`, `costByTicket`), fed by `useTicketActivity` + WS `agent-events`, authoritative `api.fetchTicketAgentActivity`. |
| Pending question for NEEDS YOU rows | `TicketMention` with status `waiting_for_info` (entity `domain/entities/ticket-mention.entity.ts`, routes `agent-mentions.routes.ts`). The question text = the agent's last comment; options = parsed from that comment when it contains a bullet/option list (fallback: free reply only). Workflow gates: `workflowRunStore` awaiting gates. Panel conclusions: `panelStore` / `run-panel` result. |
| Progress bar | `workflowRunStore` current run `stepIndex / steps.length` when a workflow run is active on the ticket; else indeterminate while `running`. |
| Conversation | Ticket comments (`TicketComments` data + `api` comments endpoints, `tickets.routes.ts`), rendered with `MarkdownRenderer`; mentions via `markdown/mentions.ts`. Event lines = ticket activity timeline (`TicketActivityTimeline` source: domain event log, `domain-event-log.routes.ts`). |
| Run block (lint/test lines) | Latest `agent_event` tool results for the running execution (`agentEventStore`). |
| Worktrees | `sessionStore` / `useSessions` worktrees attached to the ticket; attach/detach = `agent-worktrees.routes.ts` / `create-worktree.ts` use-case and existing detach flow in `TicketDetail`. |
| PR + checks | `pullRequestStore` (`usePullRequestPolling`). |
| Deliverables | `TicketDeliverables` data, `deliverableTypesStore` for kind badges, `openDeliverableOverlay` in `uiStore`. |
| Sessions / shells | `sessionStore` sessions bound to the ticket (tab engine kinds `claude`, `shell`, `execution`); terminal rendering `TerminalView`; create = `create-session-from-ticket.ts` / `sessions.routes.ts`. |
| Diff | **New read endpoint** (see below) — or reuse `repositories.routes.ts` git helpers if a diff endpoint exists. |
| Code tree / open in editor | Workspace actions in `WorktreeHeader` (Cursor/VS Code open), `overlay-sync` for overlays. Tree: new lightweight endpoint or `files.routes.ts` if it lists directories. |
| Pinned actions, Sync overlay | `settingsStore` pinned icons / workspace actions; `OverlaySyncButton`. |
| Suggestions | Client-side rules from ticket state (see SPEC § 5) + optional assistant proposals. |
| NEXT strip | Client rule (tests green + PR exists → commit/push/review) or assistant proposal. |

## New UI state (client only)

`stores/workStore.ts` (zustand, persisted under `localStorage['fleex_work']`):

```ts
interface WorkState {
  selectedTicketId: string | null;
  view: 'task' | 'new';
  boardFilter: string | 'all';
  rightPanel: 'context' | 'thread' | 'diff' | 'code' | 'deliv' | null;
  selectedThreadId: string | null;
  threadTab: 'conv' | 'stream';
  shellOpen: boolean;          // drawer
  shellMode: boolean;          // center takeover
  shellLayout: '1' | 'cols' | 'rows' | 'three' | 'grid';
  activeShellIndex: number;
  draft: { text: string; repoKeys: string[]; boardId: string | null; type: 'build'|'think'|'fix'; size: 'S'|'M'|'L' };
}
```

Route: `/work` (no sub-route needed; `/work/:ticketId` optional for deep links). Add `'work'` to `ActivePanel` in `uiStore.ts` **and** the same local type in `router/RouterSync.tsx` (both must be updated; the router has its own copy).

## New server pieces

### Phase 2 — read-only
- `GET /api/worktrees/:id/diff` → `{ base, head, files: [{ path, additions, deletions, hunks: [{ header, lines: [{ kind: 'ctx'|'add'|'del', text }] }] }] }`. Implement with `git diff <base>...HEAD` + `git diff` (unstaged) merged; base = default branch. Cap size (e.g. 400 KB) and return `truncated: true`.
- `GET /api/worktrees/:id/tree?depth=3` → nested `{ name, path, kind: 'dir'|'file', changed?: boolean }[]`, `changed` from `git status --porcelain`.

### Phase 3 — agent threads (assistant ⇄ agent)
Today: `runAssistant` (sidepanel-host) is a bounded Messages-API loop over CLI tools, not ticket-scoped; agents are addressed through `@agent:` mentions on ticket comments → `TicketMention` → `ExecuteAgent`; panels run N personas + an orchestrator (`run-panel`). The thread is « a two-party panel, open over time, orchestrated by the assistant ».

Minimal additions:
1. **Thread entity** `agent_thread { id, ticketId, initiator: 'assistant', personaId, brief, forwardedContext: string[], status: 'running'|'waiting'|'done'|'failed', executionId?, summary?, createdAt, concludedAt }`. Turns = ticket comments with `threadId` (add nullable `thread_id` to comments; the orchestration design doc already anticipates a `parentId`).
2. **Assistant identity** as a comment author (`authorType: 'assistant'`), and ticket-scoped assistant runs: `POST /api/tickets/:id/assistant/messages` starting a loop primed with `GET /tickets/:id/context`.
3. **Assistant tool `delegate_to_persona({ personaId, brief, forward: [...] })`** → creates the thread, posts the opening turn as a comment with `@agent:<persona>` (reusing the mention pipeline → `ExecuteAgent`), then **suspends** the assistant loop. Wake on `mention:resolved` / `mention:waiting_for_info` domain events; the agent's reply becomes a thread turn; the assistant decides to continue (post another turn → new mention) or conclude (`conclude_thread({ summary })` → posts `Retour de … : summary` in the main stream, closes the thread, optionally attaches an inline question).
4. **Stream tab** reads `agentEventStore` for `thread.executionId` — no server change.
5. WS: emit `thread:created|updated|concluded` on the unified WS (`unified-ws.ts`) so the card and the Threads panel update live.

Non-goals for Phase 3: parallel threads orchestration policy, cross-ticket threads, cost caps (reuse execution cost tracking).

## Writes the view performs (all existing endpoints)

- Create ticket (`create-ticket.ts`), update status/board/type/size (`apply-ticket-mutation.ts`).
- Create worktree from ticket, detach worktree.
- Post comment (user reply, inline question answer = a comment with the chosen option text), mention agent.
- Create session (shell / claude) bound to ticket; kill session.
- Start workflow run (`create-workflow-run.ts`), answer gate.
- Overlay sync (`overlay-sync.routes.ts`).
