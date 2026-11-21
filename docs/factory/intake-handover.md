# Factory intake: hand-over for the next PR

Written at the end of the session that built PR #354 (Factory, lots 1 to 38), to start the next one from a fresh
session. Read this, then open `docs/factory/intake.html` in a browser (the mock-up of what follows), then
`packages/server/src/factory/README.md` (what the Factory is today).

Nothing described here is built. Everything under "Decided" was said by the owner; everything under "Proposed" is
the previous session's opinion and can be overturned.

## Progress

- **Picks (owner, 2026-11-19)**: Item: none of J1 to J3 as drawn. An item is drawn like a ticket, as an object in
  relief from an icon, here the source's logo (Slack, Gmail, GitHub…), as tickets are from their type's icon
  (`ticketToken.ts`). To draw on a mock-up before step 3. Intake: **I1**, a loading dock. New ticket: **N3**, a
  Desk machine and a command on the card.
- **Order changed**: the Desk went first (it needs no migration and no item), then items.
- **Done: the Desk** (step 2). See "Desks" in `packages/server/src/factory/README.md`. The whole new-task flow is
  mounted on it, import from a link or a source included.
- **Done: items and intakes** (steps 1 and 3 of the plan below, and the intake of step 7 without its source). Items
  have their own table (047) and travel the floor; an intake holds them for the quiet delay, drops by rule, counts;
  items are drawn in relief from their source's mark. See "Items, and the intakes they come in by" in the README.
  **The plan's step 1 changed**: `factory_tickets` and `factory_runs` were not touched; an item keeps its place in
  its own row, and run rows stay for tickets only.
- **Done: a station on an item** (step 5): the item in words is the run's brief, the visits and replies are kept in
  `factory_item_runs` (048).
- **Done: intake settings in two parts** (every source, then its source's own fields), keep-only rules, several
  intakes per source (`fields`, 049). Stopped before the Slack connector, as asked: it will fill Slack's `fields` (channel, kind,
  bot) and call `POST /api/factory/items`.
- **Next**: the Slack connector, Triage (step 4), Make a ticket (6), then the sources' connectors, each calling
  `POST /api/factory/items` (Slack first: polling `conversations.history` with the user token, or the events API).
- **Naming to settle**: the command card's **Intake** (hand tickets over to Inbound) will clash with the intake
  machines. Rename one of them before step 7.

## The aim

The owner wants the Factory to be the one place where everything that may ask something of them arrives: a Slack
message, a mail that expects an answer, a GitHub review request, a calendar event that needs preparing, a task they
create. Each thing is either acted on or ignored, on the floor. Most of it is not software development: no
repository, no worktree, often no agent at all.

So the Factory becomes **item-driven**. A ticket is one kind of item. The rest of Fleex stays ticket-driven.

## Decided

1. **An item is not a ticket.** Creating a ticket for everything that comes in is ruled out: about 100 mails a day
   plus Slack would double in a week a database that holds about 800 tickets after ten months, and Supabase already
   times out on some counts and statistics. An item becomes a ticket only when a machine on the floor makes it one.
2. **Intake, option 3**: an intake drops what its rules recognise (newsletter, bot) without asking a model; what is
   dropped never reaches the floor. Everything else comes in as an item and the floor sorts it.
3. **Junk at the exit is archived** (soft delete), at the very least. Not deleted outright.
4. **First sources: Slack, Gmail, GitHub**, and **creating a ticket from the Factory page** with the creation form
   of the Work view, which already does the job well. Going through the Work view to create a ticket is not
   acceptable.
5. **An item is a conversation, not a message.** "hi" followed three messages later by the real ask is one item.
6. **An agent does not need a ticket.** The owner pointed out that routines already run agents and produce
   deliverables with no ticket. Verified, see "What the code says".
7. **Working method, unchanged**: for anything functional or visual, an interactive HTML mock-up drawn like the
   floor comes first, the owner picks, then "go build". One commit per lot. Replies to the owner in French, product
   text in English, never "..." in a wording.

## Waiting for a pick (the mock-up)

`docs/factory/intake.html` has three groups of cards. The owner had not picked when this was written.

| Group | Options | Previous session's preference |
|---|---|---|
| What an item looks like | J1 a disc in its source's colour · J2 a ticket-like object with a badge · J3 a sheet of paper | J3 |
| What an intake looks like | I1 a loading dock, 3 by 2 tiles, with HELD and DROPPED counters · I2 a painted zone like Inbound | I1 |
| Creating a ticket | N1 a button on the command card, lands in Inbound · N2 a Desk machine on the floor · N3 both | N3 |

## Proposed model

- **Item**: a row of the Factory's own, never in `tickets`. Kind (`ticket`, `slack`, `gmail`, `github`), a key in
  its source (workspace + channel + thread, mail thread id, repository + pull request number), title, who it is
  from, an excerpt, a link back to the source, tags, priority, message count, last activity, archived at. The
  content is not copied: it is read again from the source when a machine needs it.
- **A ticket on the floor** is an item of kind `ticket` that points to its row in `tickets`.
- **A new message on a known key** updates the item. If the item is archived, it comes back. If a draft is waiting
  at a gate, proposed: the item goes back to triage and the draft is thrown away.
- **Quiet delay**: an item stays in its intake while its conversation moves, and leaves once it has been quiet for
  the intake's delay.
- **New machines**:
  - *Intake*, one per source: watches, drops by rule, holds for the quiet delay, counts what it dropped.
  - *Desk*: opens the ticket creation form; the ticket is born there.
  - *Triage*: reads the conversation in one model call with no tools and names a way out (`junk`, `for me`,
    `answer`, `ticket`, or whatever the station lists). It is not an agent run and must not count against the
    floor's runs per hour (default 20), or the floor would starve.
  - *Make a ticket*: creates the ticket from the item (the conversation as description, the source as a link); the
    same token carries on, now a ticket.
  - *Send*: posts a reply where the conversation lives. It can fail, so two ways out, like a script station.
    Always behind a human gate by default.
  - *Archive exit*: an exit that archives the item instead of setting `done`.
- **Stations on an item**: an agent, skill or panel station runs with `ticketId: null` and a subject whose brief is
  the conversation. What it produces (a draft) is a deliverable with no ticket, tied to the item.
- **Opening an item** is not the Work view: a popup with the conversation, what triage said, the drafts, and the
  actions (approve and send, junk, make a ticket).

## What the code says (verified by reading it, paths from `packages/`)

**Agents without a ticket**
- `server/src/application/use-cases/execute-agent.ts:2207` `executeForWorkflowStep` takes `ticketId: string | null`,
  `routineId?`, `subject?: RunSubject`. Without a ticket it builds a workspace with `ensureRoutineWorkspace`
  (line 2832), which accepts a null routine and names the workspace `adhoc`.
- `RunSubject` (`shared/src/types/routine.ts:16`): `repos`, `brief`, `documentIds`, `boardId`. The prompt for a run
  with no ticket is `composeRoutineUserPrompt` (`execute-agent.ts:2534`): it says "Routine run, not attached to a
  ticket", then the brief, then the repositories. That wording will need an item variant. `documentIds` has no
  consumer.
- The execution row is written by `agentEventStore.startExecution` with a nullable `ticketId` and nothing else: an
  execution with neither a ticket nor a routine already exists for every routine step, and nothing forbids it.
  The columns `routine_id` and `workflow_run_id` that migration 025 added to `agent_event_executions` are never
  written.
- "Exactly one anchor" is enforced on `workflow_runs` only (`domain/entities/workflow-run.entity.ts:37`, and a CHECK
  on Postgres in `025_add_routines.ts:138`). A Factory station does not create a workflow run, so it is not
  concerned.
- Deliverables: `SubmitDeliverableUseCase` (`application/use-cases/submit-deliverable.ts`) takes a nullable
  `ticketId` and checks no anchor. A deliverable with no ticket and no run is "standalone" (migration 044) and
  shows in Docs. A draft tied to an item would need a way to be told apart from those.

**The Factory's own coupling to tickets**
- `server/src/factory/engine.ts:70` `FactoryEngineDeps`: `loadTicket`, `setStatus`, `applyChange`,
  `recordDecision`, all by ticket id. Call sites: 381, 517 to 521, 705, 714, 747. Wiring in
  `factory/factory.module.ts:102`.
- `factory/types.ts:164` `FactoryTicketInfo`: id, displayId, title, type, priority, status, tags, boardId,
  complexity, favorite, blocked. This is all the engine routes on.
- Migration `045_factory.ts`: `factory_tickets.ticket_id` is the primary key and a foreign key to `tickets`;
  `factory_runs.ticket_id` is NOT NULL and a foreign key to `tickets`. Items cannot be stored there as it is. 045 is
  the highest migration; a committed migration is never modified (root `CLAUDE.md`): the next one is 046, with
  Supabase RLS for any new table.
- `factory/station-runner.ts`: stations present themselves to the workflow step executors as a one-step workflow,
  with the ticket id; comments and deliverables are posted on the ticket.

**Slack** (reading exists, by permalink only)
- A user token (`xoxp-`, bot tokens refused) kept in `~/.fleex/connectors/slack.json` on the host, not in the
  database (`infrastructure/adapters/file-slack-connection.store.ts`, `use-cases/manage-slack-connector.ts`).
  Scopes asked for: `channels:history`, `groups:history`, `im:history`, `mpim:history`, `users:read`. **No write
  scope**: sending needs `chat:write` and the owner's consent to a new scope.
- `infrastructure/adapters/slack-web-api.client.ts` calls three methods: `auth.test`, `conversations.replies`,
  `users.info`. **Nothing listens or polls**: no events API, no socket mode, no `conversations.history`.
- `infrastructure/adapters/claude-slack-thread-synthesizer.ts`: one model call on a transcript already fetched,
  with no tools and `maxTurns: 0`. This is the pattern for Triage.
- A fallback import (`claude-slack-import.adapter.ts`) runs an agent with the user's own Slack MCP; not a base to
  build on.

**GitHub**
- Only through the `gh` CLI (`infrastructure/adapters/github-graphql.adapter.ts` and others). No octokit, no token
  in the environment.
- **Notifications are not read anywhere.** Review requests are read from open pull requests
  (`github-graphql.adapter.ts:620`) and filtered for the current user in `use-cases/get-import-browse.ts:95`.
  That data refreshes with `domain/services/repository-refresh-scheduler.ts`, which is off by default.

**Gmail and Google**
- Gmail: nothing in the code.
- Google Calendar is read through the `gog` CLI (`infrastructure/google/google-calendar.client.ts`), with one
  write (answering an invitation). Whether `gog` can also read and send mail was not checked: check it before
  designing a Gmail connector, it may spare an OAuth flow.

**Creating a ticket**
- The Work view's form is `web/src/components/work/new/NewTask.tsx` and `NewTaskCompose.tsx`. Creation is
  `NewTaskCompose.start()` (lines 99 to 162): `createTicket`, epics, repository links, GitHub issue sync.
- **It is not reusable as it is**: it reads and writes the Work store (`draft`, `updateDraft`, `resetDraft`) and,
  once the ticket is created, selects it and switches the Work view to it. Mounting it over the floor needs an
  "on created" hook that the Factory can use instead (extend it, do not fork it: `packages/web/CLAUDE.md`).
- `web/src/components/modals/CreateTaskModal.tsx` is another creator that does not depend on the Work store. The
  owner asked for the Work view's form, not this one.
- A ticket created with `status: 'doing'` by that form; the Factory then has to take it (`factory_tickets` row) and
  put it at the Desk.

**Soft delete, as done elsewhere**
- `tickets.archived_at` (migration 008), `archive()` and `unarchive()` on the entity, and a filter
  `archived_at IS NULL` in each query. `ticket_todo_items.deleted_at` works the same way. No shared helper.

**Scheduling**
- `domain/services/routine-scheduler.ts` ticks every 60 s and fires routines, each through a workflow run: it is
  not a generic job runner. `repository-refresh-scheduler.ts` is the simple pattern to copy for a poll (one
  `setInterval`, a guard against re-entry).
- Only one process must poll: see `domain/services/scheduler-role.ts` (`FLEEX_ROUTINE_SCHEDULER`), which already
  decides which instance runs the routine scheduler.
- The Factory engine itself ticks every 250 ms and can hold what a quiet delay needs.

## Open questions

1. How long is an archive kept before it is purged for good?
2. A message arrives while a draft waits at a gate: back to triage, draft thrown away? (proposed)
3. Triage: its own cap per hour, and which model? (the Slack synthesizer uses the small one)
4. Slack: listening needs either the events API (a public endpoint or socket mode, and an app) or polling
   `conversations.history` per watched conversation with the user token. Which one the owner's Slack allows was not
   looked at.
5. Gmail: `gog`, the Gmail API with OAuth, or IMAP?
6. GitHub: the notifications API through `gh api notifications`, or the review requests already read from open
   pull requests?
7. One floor, or a sorting floor and a development floor? Today there is one floor (`default`).
8. "For me": a zone for what the owner must do by hand. How is it marked as done?
9. The calendar (an event that needs preparing) is part of the aim but was not asked for in the first sources.
10. Which board does "Make a ticket" use, and does the item keep any link to the ticket once it is one?

## Proposed order of work

Each step is a lot, each lot starts with a mock-up when it shows or asks something.

1. **Items in the engine**: migration 046 (an items table with RLS; `factory_tickets` and `factory_runs` able to
   hold an item that is not a ticket), the engine's dependencies turned from "ticket" to "item" with the ticket as
   one adapter, nothing new on the floor. Every existing test must still pass.
2. **The Desk and the creation form over the floor.** No new source: it proves the popup and "born on the floor".
3. **An item on the floor, by hand**: a way to inject a fake item (a route or a CLI command), its token, its popup,
   the archive exit. No source yet.
4. **Triage**, on those hand-made items.
5. **A station running on an item** (agent with the conversation as brief, a draft kept on the item), and the gate.
6. **Make a ticket.**
7. **The Slack intake**: conversations, quiet delay, drop rules, counters.
8. **Send**, for Slack.
9. **GitHub**, then **Gmail**, one adapter each.

## Where PR #354 stands

- Branch `claude/fervent-mccarthy-qzdcpy`, draft, 38 lots, CI green at lot 38. Its description lists what was and
  was not tested. The previous session recommended merging it before starting this work, on a new branch.
- **Never run end to end**: the server was never booted with the Factory on where this was written (no `qa`
  workspace in the cloud container; the owner has one on their machine). A script station never ran a real
  command, a Set gantry never wrote on a real ticket. The first thing worth doing in an environment that has the
  `qa` workspace is the QA described in the root `CLAUDE.md`.
- Limits and unanswered points are in the PR description ("Known limits") and in the Factory README.

## To start the next session

Paste this:

> Read `docs/factory/intake-handover.md`, then `docs/factory/intake.html` and
> `packages/server/src/factory/README.md`. We are starting the PR that makes the Factory item-driven and adds
> intakes (Slack, Gmail, GitHub, and a Desk to create tickets from the floor). My picks on the mock-up are:
> Item …, Intake …, New ticket …. Start with step 1 of "Proposed order of work" and tell me first what you
> would change in that plan.
