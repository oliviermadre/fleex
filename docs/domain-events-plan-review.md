# Domain Events Architecture Plan - Review & Gaps

## Overall Assessment

The plan is **architecturally sound**. The diagnosis (3-4 code paths per business action, inconsistent side effects, fragile wiring) is accurate. The phased approach and listener grouping are clean. Below are gaps, challenges, and recommendations found after a thorough codebase audit.

---

## Missing Events in Catalog

### 1. `comment.updated` - HIGH

`agent-comments.routes.ts` PATCH handler and `tickets.routes.ts` PATCH `/api/mentions/:id/from-comment` both broadcast `comment:updated` with side effects (new mention creation, auto-review triggers). No `UpdateCommentUseCase` exists.

**Action**: Add to catalog and Phase 1:

```
comment.updated  { comment, ticketId, createdMentions[] }
```

### 2. `comment.deleted` - use case extraction missing

Listed in catalog but no `DeleteCommentUseCase` planned. `agent-comments.routes.ts` DELETE and `tickets.routes.ts` both handle deletion inline.

**Action**: Extract `DeleteCommentUseCase`, emit `comment.deleted`.

### 3. `persona.execution_started/completed/failed` - MEDIUM

`persona.routes.ts` broadcasts `persona:execution_started` on "Play". `agent-events-ws.ts` broadcasts `persona:execution_completed` and `persona:execution_failed`. None are in the event catalog.

**Action**: Add to catalog:

```
persona.execution_started    { personaId, mentionIds }
persona.execution_completed  { personaId, status, mentionId }
persona.execution_failed     { personaId, error, mentionId }
```

### 4. `ticket.linked` / `ticket.unlinked` - consider

`agent-worktrees.routes.ts` creates worktree links (broadcasts `ticket:updated`). `tickets.routes.ts` has explicit POST/DELETE for links. These are distinct business actions. Consider whether they deserve their own events or fold into `ticket.updated` with a `changes` field capturing the link delta.

### 5. Merge-detector side effects in `main.ts` - HIGH (ACTIVE BUG)

`detectMerge.execute()` returns moved ticket IDs, then `main.ts` manually fetches each and broadcasts `ticket:moved`. This wiring happens **outside the use case**. Critically, **`handleTicketDone()` is never called**, meaning mentions are NOT auto-resolved when a ticket moves to done via PR merge.

**Action**: `DetectMergeUseCase` should emit `ticket.moved` for each moved ticket. The `auto-review.listener` handles the rest, fixing the bug.

### 6. Repository refresh events - LEAVE AS-IS

`repository-refresh-scheduler.ts` broadcasts `repo:refresh-started`, `repo:summaries-updated`, `repo:refresh-complete`, `repo:rate-limit-warning` via its own `setBroadcast()` callback. These are infrastructure/polling concerns, not business domain events. Leave on their own channel.

### 7. `worktree.created` - listed but orphaned

In catalog as `worktree.created { ticketId?, org, repo, branch, path }` but no use case is planned to emit it. Either add to Phase 5/6 or remove from catalog.

---

## Missing Use Case Extractions

### 8. `UpdateCommentUseCase` - HIGH

The PATCH handler in `agent-comments.routes.ts` (lines ~150-210) has significant logic: calls store methods, creates new mentions, broadcasts `comment:updated` and `mention:created`, triggers auto-review. Needs a proper use case.

### 9. `DeleteCommentUseCase`

Inline deletion in both route files.

### 10. `AcknowledgeMentionUseCase` and `WaitForInfoMentionUseCase` - MEDIUM

`agent-mentions.routes.ts` handles PATCH `/mentions/:id/acknowledge` and `/mentions/:id/wait-for-info` inline. Plan says "also add events for other mention transitions - same pattern" but is not explicit. These need dedicated use cases:

- `AcknowledgeMentionUseCase` -> emits `mention.acknowledged`
- `WaitForInfoMentionUseCase` -> emits `mention.waiting_for_info`, triggers `handleMentionWaitingForInfo()`

### 11. `DeleteMentionUseCase` - LOW

`tickets.routes.ts` handles DELETE `/api/mentions/:id` inline.

---

## Command Bus Assessment

The plan mentions wanting "Command Bus, Command Handler" but only describes an Event Bus.

**Recommendation: Do NOT add a Command Bus now.**

The 25 existing use cases already serve as command handlers - `PostCommentUseCase.execute()` IS effectively `handlePostCommentCommand()`. Adding a formal Command Bus wrapping use cases would be over-engineering:

| Pattern       | Current                                | With Command Bus                                     |
| ------------- | -------------------------------------- | ---------------------------------------------------- |
| Route handler | `container.postComment.execute({...})` | `commandBus.dispatch(new PostCommentCommand({...}))` |
| Side effects  | Manual inline                          | Event bus listeners                                  |
| Cross-cutting | None needed yet                        | Validation, auth, logging middleware                 |

A Command Bus adds value when you need cross-cutting middleware (validation, authorization, logging, retry) applied uniformly across all commands. Currently the use cases don't have this need. Focus on the Event Bus first. Add Command Bus later if cross-cutting concerns start duplicating.

---

## Architecture Concerns

### 12. Bun + EventEmitter compatibility

Bun fully supports `EventEmitter` from `node:events`. However, Bun's `EventEmitter` has the same default `maxListeners` limit (10). With 5 listener modules x multiple events, you'll hit warnings.

**Action**: Add `emitter.setMaxListeners(50)` in `DomainEventBus` constructor.

### 13. Listener error isolation - be explicit

Plan says "fire-and-forget, async errors caught + logged." Implementation matters:

```typescript
// BAD: one listener failure kills the rest
async emit(event, payload) {
  for (const handler of this.handlers[event]) {
    await handler(payload); // throws -> next handlers don't run
  }
}

// GOOD: isolated
async emit(event, payload) {
  const handlers = this.handlers[event] ?? [];
  await Promise.allSettled(handlers.map(h => h(payload)));
  // log rejected promises
}
```

### 14. `agentBroadcast` vs `ticketBroadcast` - HIGH

The plan's `broadcast.listener.ts` says it handles ALL WS broadcasts. But the current architecture has **two separate broadcast channels**:

- `ticketBroadcast`: broadcasts to ALL connected web clients
- `agentBroadcast`: broadcasts to **targeted agents** (filters by ticket subscription, mention target, private comment recipient)

`agent-ws.ts` does filtering logic (`shouldReceive()`) to decide which agents see which events. The broadcast listener needs to call BOTH, or `agent-ws.ts` needs to be restructured to listen on the event bus with its own filtering.

**Action**: Either:

- (a) `broadcast.listener.ts` calls both `ticketBroadcast(type, data)` and `agentBroadcast(type, data)`, OR
- (b) Keep `agent-ws.ts` subscribing to the event bus directly with its own smart filtering listener

Option (b) is cleaner long-term.

### 15. `executionId` context lost in domain events - MEDIUM

`agent-events-ws.ts` uses `executeAgent.onTicketUpdate` to know WHICH execution caused a ticket update (needed for the execution event stream). After refactoring, if ticket updates go through use cases emitting domain events, the `executionId` context is lost unless added to event payloads.

**Action**: Add optional `executionId?: string` to `ticket.updated`, `ticket.moved`, `comment.created`, `deliverable.created` payloads when triggered from agent execution context.

### 16. Listener ordering is implicit

Plan says "register broadcast first so UI updates before cascading actions." This depends on registration order which is fragile.

**Action**: Consider explicit priority levels in the event bus, or at minimum document prominently in `registerAllListeners()`.

---

## Missing from Phase 7 Cleanup

| Item                                          | Location                                      |
| --------------------------------------------- | --------------------------------------------- |
| Merge detection wiring                        | `main.ts` lines 131-138                       |
| `agent-worktrees.routes.ts` inline broadcast  | `ticket:updated` after worktree link creation |
| `repository-refresh-scheduler.setBroadcast()` | If repo events migrate (recommended: don't)   |

---

## Revised Event Catalog

### Ticket Engine

```
comment.created        { comment, ticketId, authorType, authorName, createdMentions[] }
comment.updated        { comment, ticketId, createdMentions[] }              # NEW
comment.deleted        { commentId, ticketId }
mention.created        { mention, ticketId }
mention.resolved       { mention, ticketId, resolvedBy }
mention.acknowledged   { mention, ticketId }
mention.waiting_for_info { mention, ticketId, agentName }
mention.deleted        { mentionId, ticketId }                               # NEW
ticket.created         { ticket, source }
ticket.updated         { ticket, changes, source, executionId? }             # UPDATED
ticket.moved           { ticket, fromStatus, toStatus, source, executionId? } # UPDATED
ticket.deleted         { ticketId }
deliverable.created    { deliverable, ticketId, agentName, executionId? }    # UPDATED
deliverable.updated    { deliverable, ticketId, agentName, oldStatus? }
```

### Board Management (unchanged)

```
board.created          { board }
board.updated          { board }
board.deleted          { boardId }
```

### Persona Management

```
persona.created             { persona }
persona.updated             { persona }
persona.deleted             { personaId }
persona.execution_started   { personaId, mentionIds }                        # NEW
persona.execution_completed { personaId, status, mentionId }                 # NEW
persona.execution_failed    { personaId, error, mentionId }                  # NEW
```

### Session Management (unchanged)

```
session.created        { session }
session.killed         { sessionId }
session.renamed        { session }
session.attached       { session }
```

### Repository / Worktree

```
worktree.created       { ticketId?, org, repo, branch, path }               # NEEDS USE CASE
```

---

## Revised Use Case Extraction List

| Use Case                            | Phase | Events Emitted                               |
| ----------------------------------- | ----- | -------------------------------------------- |
| `PostCommentUseCase` (modify)       | 1     | `comment.created`                            |
| `UpdateCommentUseCase` (NEW)        | 1     | `comment.updated`                            |
| `DeleteCommentUseCase` (NEW)        | 1     | `comment.deleted`                            |
| `ResolveMentionUseCase` (modify)    | 2     | `mention.resolved`                           |
| `AcknowledgeMentionUseCase` (NEW)   | 2     | `mention.acknowledged`                       |
| `WaitForInfoMentionUseCase` (NEW)   | 2     | `mention.waiting_for_info`                   |
| `DeleteMentionUseCase` (NEW)        | 2     | `mention.deleted`                            |
| `MoveTicketUseCase` (NEW)           | 3     | `ticket.moved`                               |
| `SubmitDeliverableUseCase` (modify) | 4     | `deliverable.created`                        |
| `UpdateTicketUseCase` (NEW)         | 5     | `ticket.updated`                             |
| `CreateTicketUseCase` (extract)     | 5     | `ticket.created`                             |
| `DeleteTicketUseCase` (extract)     | 5     | `ticket.deleted`                             |
| `DetectMergeUseCase` (modify)       | 5     | `ticket.moved` (fixes active bug)            |
| Board CRUD use cases                | 6     | `board.created/updated/deleted`              |
| Persona use cases (modify)          | 6     | `persona.created/updated/deleted`            |
| Persona execution events            | 6     | `persona.execution_started/completed/failed` |
| Session use cases                   | 6     | `session.created/killed/renamed`             |

---

## Summary of Gaps by Severity

| Gap                                                                | Severity | Type                                       |
| ------------------------------------------------------------------ | -------- | ------------------------------------------ |
| `comment.updated` event + `UpdateCommentUseCase`                   | **HIGH** | Missing event + use case                   |
| merge-detector misses `handleTicketDone()`                         | **HIGH** | Active bug                                 |
| `agentBroadcast` (targeted) vs `ticketBroadcast` (all) distinction | **HIGH** | Missing from broadcast listener design     |
| `persona.execution_*` events                                       | MEDIUM   | Missing from catalog                       |
| `AcknowledgeMention` / `WaitForInfoMention` use cases              | MEDIUM   | Missing use cases                          |
| `executionId` context in domain events                             | MEDIUM   | Architecture gap                           |
| `comment.deleted` + `DeleteCommentUseCase`                         | MEDIUM   | Missing use case                           |
| `EventEmitter.maxListeners` for Bun                                | LOW      | Bun compatibility                          |
| `DeleteMentionUseCase`                                             | LOW      | Missing use case                           |
| `agent-worktrees.routes.ts` side effects                           | LOW      | Not covered in any phase                   |
| Command Bus                                                        | N/A      | **Not needed** - use cases serve this role |
