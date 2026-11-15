# Factory (experimental)

A floor of machines that the tickets handed over to it travel through: belts, arms (optionally filtered by type,
priority, tag or station outcome), stations (an agent, a skill, a panel, a human gate, or a status change), zones
and exits. Nothing is routed in advance: a ticket reacts to what it stands on. The concept and its interactive
mock-up are in `docs/factory/`.

When a station's agent asks a question instead of answering, the ticket waits in the station, pulsing with a "?".
It leaves only by an arm filtered on the reserved outcome `question` (an unfiltered arm leaves it alone, so an
unanswered ticket never carries on down the normal path). A Factory run creates no mention and no workflow step run,
so the ticket view's usual cards never see it: the Factory banner on the ticket says it waits for you and carries the
action (Run again, the gate's outcomes). Replying in the thread alone restarts nothing.

The floor has no edge: machines can be placed anywhere, and the page draws it as far as what is built plus a margin.
Where two belts must cross, a **bridge** tile carries each ticket straight across.

A ticket is handed over by hand, from the Factory page. It lands in the **Inbound** zone (one per floor, created on
demand) and waits there: dragging it onto a belt or a machine is what starts it. There is no automatic intake.

## Reading the floor

Every station visit is a row in `factory_runs`; a ticket reaching an exit leaves one too (executor `exit`, from
hand-over to exit, which is the lead time). `GET /api/factory/stats?days=7` turns those rows into figures per machine
(`stats.ts`, a pure function): runs, failures, questions, outcomes, average run time, time spent waiting for a human
(a gate's decision; a question until the ticket's next run) and cost. A run is priced by the agent execution it
started; a panel starts one execution per persona and links only its synthesis, so a panel run also takes the
ticket's other executions started while it ran. The route only reads, and its result is kept 20 seconds.

On the page, four lenses tint stations and zones (what stands there now, cost, run time, human wait), the side panel
lists where tickets stand and what the floor did over the period, and a station or a zone opens on everything it
holds (double-click, or V).

Off unless `factoryEnabled` is `true` in the workspace config (Settings › General). While off the engine does not
tick, no `factory_*` table is read or written, the routes answer 403 and the nav entry is hidden.

## What it touches

Everything lives here, in `packages/web/src/factory/`, and in three tables created by migration `045_factory`
(`factory_floors`, `factory_tickets`, `factory_runs`). No existing table is altered: a ticket is "handed over" when it
has a row in `factory_tickets`.

It does write through the normal paths, as any automation would: a zone, a status station or the exit changes the
ticket status with `ApplyTicketMutationUseCase` (so moving to `done` triggers the usual summary and mention
resolution), and a station posts the agent's comment and deliverable on the ticket. Switching the flag off stops the
machines; it does not undo those writes.

Stations reuse the workflow step executors (`AgentStepExecutor`, `SkillStepExecutor`, `PanelStepExecutor`) by
presenting each station as a one-step workflow named "Factory". Runs therefore share the global SDK concurrency
limiter and the execution log. The Factory adds two limits of its own, editable on the page: runs started per hour
(default 20) and runs in flight (default 3).

Supported storage: SQLite and Supabase. On pgsql the store is `null` and the module is absent, like workflows.

## Hooks in existing code

| File | What |
|---|---|
| `infrastructure/migrations/index.ts` | registers `045_factory` |
| `infrastructure/adapters/storage-factory.ts` | `factoryStore` per driver |
| `infrastructure/container.ts` | builds the module, exposes `container.factory` |
| `main.ts` | registers `/api/factory/*`, starts and stops the engine |
| `application/ports/config.port.ts` | `factoryEnabled`, `isFactoryEnabled()` |
| `infrastructure/http/focus.routes.ts` | a Factory-managed ticket is not listed as `idle` |
| web: `uiStore.ts`, `RouterSync.tsx`, `MainPanel.tsx`, `AppLayout.tsx`, `NavSidebar.tsx` | the `/factory` page and its nav entry |
| web: `SettingsPanel.tsx`, `settingsStore.ts` | the switch |
| web: `work/WorkView.tsx` | the "Managed by the Factory" banner on a ticket |

## Removing it

1. Switch the flag off, then run the migration's `down()` (`cli-migrate.ts rollback`), or drop the three tables.
2. Delete this folder, `packages/web/src/factory/`, the migration file and the test files
   (`tests/unit/factory-*.test.ts`).
3. Revert the hooks listed above: each is a few lines that mention `factory`.

## Not covered by tests

The engine, the stats and the SQLite store are tested (`factory-engine.test.ts`, `factory-stats.test.ts`,
`factory-store-sqlite.bun.test.ts`). The Supabase store and a real agent run through a station are not: they need a
live database and an API key. So the cost figures have only been checked against made-up executions.
