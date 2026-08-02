# Execution recovery policy

Single policy for what happens when an agent execution does not reach a normal
completion. Referenced from `execute-agent.ts` and
`recover-orphaned-workflow-steps.ts`.

## The invariant

> **A mention never returns to `pending` without an explicit human action.**

`TicketMentionEntity.resetToPending()` is called from exactly one place:
`ExecuteAgentUseCase.runMention()` — the ▶ / Relaunch / Force relaunch button.
`wakeUp()` (`waiting_for_info` → `pending`) is the only other transition back
into the queue, and it is triggered by a human posting a comment: a new
instruction, not a retry.

Before this policy, three other paths silently re-queued a mention (timeout,
user cancel, server restart). Because `handleAutoTriggerAgent` calls
`execute(personaId)` — which sweeps *every* `pending` mention of that persona —
a re-queued mention would be re-dispatched by the next unrelated mention to the
same agent: an invisible retry loop on an unresolved cause.

## The table

| Event | `execution.status` | `execution_end.reason` | `mention.status` | Relaunchable |
|---|---|---|---|---|
| Normal completion | `completed` | — | `resolved` / `waiting_for_info` | n/a (counter reset) |
| Thrown error, post-acknowledge | `failed` | classified code | `failed` | one click |
| Thrown error, pre-acknowledge | `failed` | `startup_error` | `failed` | one click |
| Silent subprocess (0 SDK messages) | `failed` | `subprocess` | `failed` | one click |
| `error_max_turns` / `error_max_budget_usd` / `error_max_structured_output_retries` | `failed` | SDK-derived code | `failed` | one click |
| **Timeout** | `failed` | `timeout` | `failed` | one click |
| **Cancel (Terminate)** | `interrupted` | `cancelled` | `failed` | one click |
| **Server restart** | `interrupted` | `server_restart` | `failed` | one click |
| Supersede (stop & redo) | `interrupted` | `cancelled` | `resolved` | no |
| Any of the above with `attemptCount >= maxAttempts` | idem | idem | `failed` | **force only** |

Cancel keeps `execution.status = 'interrupted'` on purpose: the audit trail must
distinguish "the human stopped it" from "the system gave up". The *mention*
still goes to `failed`, because the alternative — back to `pending` — is the
silent-retry bug above.

## Attempt budget

- `attemptCount` counts SDK executions **started** for a mention. It is
  incremented once at dispatch, *before* the worktree is created, so failures to
  even start (quota, auth, workspace error) are counted too.
- Internal retries that stay inside one dispatch (the `stale_resume_session`
  retry) do **not** consume an attempt.
- `resolve()` and `wakeUp()` reset it to `0`: a success, or a fresh human
  instruction, starts a new budget.
- The ceiling is `AppConfig.agentMaxAttempts` (default `3`). `0` or a negative
  value means "no cap" so a bad config can never freeze an instance.
- **Dead-letter is a derived predicate**, not a status:
  `status === 'failed' && maxAttempts > 0 && attemptCount >= maxAttempts`.
  At that point `POST /api/mentions/:id/run` answers `409 attempts_exhausted`
  and the UI swaps Relaunch for a confirmed **Force relaunch**, which resets the
  counter. We remove the *automatic* loop, never the user's hand.

## Failure reasons

The server emits a code from the closed `MentionFailureReason` union plus an
optional raw `detail` (stderr excerpt, SDK error text). **No user-facing copy is
produced server-side** — labels and remediations live in the web client
(`crashedMentionCards.ts`), in English, like the rest of the UI.

Classification order (`classify-crash.ts`):

1. `explicit` — a policy decision Fleex already knows (`timeout`, `cancelled`,
   `server_restart`, `subprocess`).
2. `SDKAssistantMessage.error` — a structured SDK code.
3. `SDKResultError.subtype` — a structured SDK result code.
4. Regex over free-form text — last resort, for errors *thrown* by the CLI.
5. `startup_error` (pre-acknowledge) or `unknown`.

## Timeouts

All three SDK entry points — mention, skill, workflow step — arm the same
`agentExecutionTimeout` **after** acquiring the global SDK slot, so queueing time
never counts against the run. A timed-out run is a failure, not a pause.

## Workflows

`recover-orphaned-workflow-steps.ts` already implemented this policy for
workflow steps (mark `failed`, no auto-retry, manual Retry). Mentions now match
it. Workflow steps keep their own budget (`step_runs.attempt`): two counters,
one policy.
