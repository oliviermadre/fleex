# Factory (experimental)

A floor of machines that the tickets handed over to it travel through: belts, arms (optionally with conditions on
the ticket or on the outcome of the station it leaves), stations (an agent, a skill, a panel, a human gate, or a status change), zones
and exits. Nothing is routed in advance: a ticket reacts to what it stands on. The concept and its interactive
mock-up are in `docs/factory/`.

An arm takes a ticket when all its conditions hold (`conditions.ts`): on the outcome, the type, the board, the tags,
whether it is a favourite (is / is not), and on the priority and the complexity, which are ordered (at least, at most,
above, below, between). With no condition it takes what the arms next to it leave. Floors saved with the earlier single
`filter` are still read, and rewritten as conditions at their next save.

An arm takes a little over a second to swing one way, and a ticket that is done in a station rests there a second
before an arm may take it: the floor is meant to be watched. The page draws the swing itself between two snapshots.

An agent station can run on another model than its persona's (`model` on the station).

When a station's agent asks a question instead of answering, the ticket waits in the station, pulsing with a "?".
It leaves only by an arm filtered on the reserved outcome `question` (an unfiltered arm leaves it alone, so an
unanswered ticket never carries on down the normal path). A Factory run creates no mention and no workflow step run,
so the ticket view's usual cards never see it: a card at the foot of the ticket's thread says it waits for you and
carries the action (Run again, the gate's outcomes). Replying to a question gives the ticket back to the station that
asked it (see "In the Work view").

The floor has no edge: machines can be placed anywhere, and the page draws it as far as what is built plus a margin.
Where two belts must cross, a **bridge** tile carries each ticket straight across. A bridge has no direction of its
own: a ticket crosses it the way it arrives, in any of the four directions, on the east-west lane or on the north-south
one. The page draws each lane the way the belts (or the arm) that feed it send tickets across. In build mode every change to the
floor can be taken back and put back (Ctrl+Z, Ctrl+Shift+Z); that history lives in the page and is gone on reload. A selection of
machines can be copied, cut and pasted (Ctrl+C, Ctrl+X, Ctrl+V, then a click): the copies keep their settings and get
new ids.

A ticket is handed over by hand, from the Factory page. It lands in the **Inbound** zone (one per floor, created on
demand) and waits there: dragging it onto a belt or a machine is what starts it. There is no automatic intake.

## Places, set aside, and the switch

A station that runs something (an agent, a skill, a panel) works on as many tickets as it has places (`cap`). Nothing
queues inside it: full, it takes nothing more and what feeds it backs up on the belts. What is done and not yet taken
by an arm waits apart, and intake also stops when that piles up as high as the station is big.

A ticket can be **set aside** in its station, three ways: the agent asked a question, the run failed, or a human took
it off the station's hands (`POST /api/factory/tickets/:id/aside`, which stops a run in progress through
`ExecuteAgentUseCase.cancelExecution`). Set aside, it stays in the station, takes none of its places, and waits to be
**put back** (`POST …/put-back`): `again` gives it back to the station for another run with what is now in the thread,
`as` with an outcome sends it out by the arm of that outcome, as if the station had concluded it. Sending it to
another machine is a move, as for any ticket. A gate has nothing to set aside: it only waits for a human.

Such a station has a **switch** (`off` on its spec, `POST /api/factory/machines/:id/power`): off, it still takes
tickets in but starts nothing on them; what already runs finishes.

A decision at a gate (`…/resolve`, with an optional `reason`) is written in the ticket's thread in the human's name,
as a comment that creates no mention and so starts no agent.

## Machines, and the version of a layout

A station that is not a status station is drawn as a machine (`packages/web/src/factory/machineArt.ts`): a head plate
with an icon for what it is, a light, as many places as it works on tickets at once (six at most), a tray for what is
done and not yet taken, and a hatched bay for what is set aside. It takes 5 by 4 tiles (the engine accepts 3 by 3 to
8 by 6). The light says: red the machine is off, green it is on, amber it is on and something in it is set aside; on a
gate, amber while something is to decide. On a machine that runs something it is the switch: a click turns it off or
on, and pointing at it says what runs, what is set aside and whether the exit is clear. The floor's glow follows the
light: amber around a machine that needs someone, a dimmer red around one that is off.

A layout carries a `version` (`layout-versions.ts`). When what a layout means changes, the version goes up and a step
is added, as a migration is for a table. A change of shape is converted when the floor is loaded. A change of
geometry cannot be: the step returns null, the old layout is kept as an archived floor (`default@v<n>-<time>` in
`factory_floors`), the floor starts over with only Inbound, the tickets go back to Inbound, and the page says so once
(`notice` in the snapshot, `POST /api/factory/notice/ack`). Version 2 is the first such step: stations grew from 3 by 3.

## Plans

A workflow can be put down on the floor as a plan (Build › Import plan): `packages/web/src/factory/workflowPlan.ts`
turns a template into machines (a station per step, an arm per way out, the belts between them, bridges where they
cross, a zone to come in by and one to gather in) and says what it could not carry over. It is a conversion made in the
page, placed like anything pasted: the workflow is not changed, nothing links the two afterwards, and the server knows
nothing of plans. A step that branches on one field of its own output keeps those values as outcomes; other conditions
cannot be evaluated by arms, so the outcomes are named after the ways out and the plan says so. Sub-workflows, routing
steps and native actions other than a status change have no equivalent yet.

## The command card

The commands of the page are a grid of four columns by three rows (`packages/web/src/factory/menu.ts`), organised as
menus that open sub-menus: Factory, then Build, then Move, Station or Area. Three levels at most. A command is found
by its place: in every build menu Undo and Redo, then Copy, Cut, Paste and the way back, sit in the same slots. A
label is one or two short words and is never cut. `factoryMenu.test.ts` holds every menu to these rules.

## Reading the floor

Every station visit is a row in `factory_runs`; a ticket reaching an exit leaves one too (executor `exit`, from
hand-over to exit, which is the lead time). `GET /api/factory/stats?days=7` turns those rows into figures per machine
(`stats.ts`, a pure function): runs, failures, questions, outcomes, average run time, time spent waiting for a human
(a gate's decision; a question until the ticket's next run) and cost. A run is priced by the agent execution it
started; a panel starts one execution per persona and links only its synthesis, so a panel run also takes the
ticket's other executions started while it ran. The route only reads, and its result is kept 20 seconds.

On the page, four layers tint stations and zones (what stands there now, cost, run time, human wait; chosen next to
the minimap), the side panel lists where tickets stand and what the floor did over the period, and a station or a zone
opens on everything it holds (double-click, or V).

## The floor itself

Out of build mode the floor is dressed (`packages/web/src/factory/floorLook.ts`): a dot where tiles meet instead of
lines, a soft light over the middle, a shadow under each station, zone and exit, and around a station the glow of its
lamp while it works (green), waits for a decision or an answer (amber) or has a failed run (red). The glow is the
station's own state bar shining on the floor, nothing more; under a layer it is off, since colour there is the layer's
reading. Build mode keeps plain lines and no light: that is the drawing one places machines against. The Grid toggle
hides the dots as it hid the lines. Light and glows are painted on a canvas of their own, redone only when the view,
the floor, the theme or a station's state changes, so their cost does not grow with the number of stations lit.

## What waits for someone

Out of build mode, the tickets that wait for someone are listed top-left over the floor (`needs.ts`,
`FactoryNeeds.tsx`): a decision at a gate, a question, a failed run, a ticket set aside by a human, one lying on the
floor; longest wait first, with what each is, where it stands and for how long. Left and right arrows walk them (up and
down still move the view, and so do left and right when nothing waits).

A click on a ticket, there or on the floor, opens its thread beside its machine (`FactoryPeek.tsx`): the whole
conversation, scrolled to its end, with the latest deliverables on top. What the ticket waits for is done from there:
a gate's decision with an optional reason, an answer (which gives the ticket back to the station that asked, see
"In the Work view"), another run after a failure. Enter, V or a second click opens the whole ticket; Escape closes the card.

## The workbench

Opening a ticket from the floor (Enter, V, a second click) brings up the Work view itself (`FactoryWorkbench.tsx`):
it slides up from the bottom over the floor and its console, nearly as wide and as high as the window, under the
app's top bar. It is `WorkView` with its queue column left out, on the ticket that was opened (the Work store's own
`openTicket`, pinned so the queue's filters do not hide it): same modes, thread, panels and tools, nothing done
differently. Left and right arrows go to the previous and the next ticket, of the ones that wait for someone or of
the same machine (a switch says which, and they are listed along the top); Escape goes back to the floor. The lighter
ticket sheet the Factory had is gone.

## In the Work view

A ticket of the floor carries the Factory with it wherever the Work view shows it, on the floor or not
(`useFactoryTicket.ts`):

- **Context** has a Factory group (`FactoryContextGroup.tsx`): where the ticket is and what happens to it there, and
  the one thing done from that panel, taking it out of the line or putting it back. A ticket a station is working on
  can be set aside; one that is set aside (by someone, by a question, by a failed run) can run its station again,
  leave as any of the station's outcomes, or be sent to another machine.
- **The thread** asks what the floor asks of someone, at its foot (`FactoryThreadCard.tsx`): a gate's decision with
  its optional reason, a question, a failed run to run again. A Factory run creates no mention and no workflow step
  run, so the thread's own "waiting for you" cards never fire for it; this is that signal. The strip the Factory used
  to put across the top of a ticket is gone: the timeline already says what happened.

What is written in the thread reaches the floor (`FactoryModule.listen`, on `comment.posted`):

- **Launching an agent, a skill or a panel by hand** (a mention in a comment, or the skill's or panel's own button) on
  a ticket a station is working on sets it aside first: the station's run is stopped, its place is freed, and the
  ticket waits for whoever launched it to put it back or send it out. A ticket that is anywhere else on the floor (a
  belt, a zone, a gate) is left as it is.
- **A plain reply** to a station that asked a question gives the ticket back to that station, which runs again with
  the answer in the thread. A reply that launches something is a launch, not an answer.
- **A workflow cannot start** on a ticket of the floor, from a mention, the API, a routine or another workflow
  (`refusesWorkflow`, asked by `CreateWorkflowRunUseCase`): the comment that asks for one is refused before it is
  written, with the reason. Give the ticket back first.

## Finding a ticket

The snapshot carries what tells tickets apart: board, type, priority, complexity, favourite. They are shown with
Fleex's own icons. On the floor a ticket is a small object in the shape of its type's icon and in its usual colour
(`ticketToken.ts` reads the shape from `TicketTypeIconSvg`, so there is one drawing per type in the app), with a star
when it is a favourite and a pip when it is urgent or high. A ticket with no type is a plain crate; too small to be
told apart, a ticket is a square. Hovering a ticket shows a card; favourites and the selected ticket carry their name on the
floor, and a toggle above the minimap names every ticket. That row of toggles also switches what each arm takes, the
ticket numbers and the grid; the choice is kept in the browser. Tab opens the list of the tickets on the floor, with
the same filters and a few more (status, machine, state, a range of complexity, blocked). Tickets of one machine, or close together on a belt, share a box that lists
them, and boxes keep clear of each other. The header has a search (title, number, tag) and filters (boards, types, priorities, favourites, waiting for a
human): what a filter leaves out is faded, never hidden. Starring a ticket from the Factory changes the ticket itself
(`PATCH /api/tickets/:id`), then `POST /api/factory/tickets/:id/refresh` re-reads it without waiting for the
engine's ten-second sweep.

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
| `application/use-cases/execute-agent.ts`, `services/step-executors/{types,agent-step-executor}.ts` | an optional model for one workflow-step execution (`model`, `modelOverride`): unset by workflows, set by an agent station |
| web: `components/ui/Modal.tsx` | a dialog leaves Escape to a popover opened from it (a general fix, found with the ticket list's filters; it can stay) |
| web: `uiStore.ts`, `RouterSync.tsx`, `MainPanel.tsx`, `AppLayout.tsx`, `NavSidebar.tsx` | the `/factory` page and its nav entry |
| web: `SettingsPanel.tsx`, `settingsStore.ts` | the switch |
| `application/use-cases/create-workflow-run.ts`, `domain/errors.ts`, `infrastructure/http/error-handler.ts`, `application/domain-event-listener.ts` | an optional `refuses(ticketId)` asked before a run is created, its `WorkflowRefusedError` (409), and the mention that asked for it closed |
| `infrastructure/http/tickets.routes.ts` | a comment that asks for a workflow on a ticket of the floor is refused before it is written |
| `infrastructure/http/skill.routes.ts`, `panel.routes.ts` | a skill or a panel launched by its button tells the Factory (`launchedByHand`) |
| web: `work/WorkView.tsx` | an `embedded` prop that leaves out the queue column, for the workbench |
| web: `work/panel/ContextPanel.tsx`, `work/task/TaskPane.tsx` | one line each: the Factory group of Context, and what the floor asks at the foot of the thread |

## Removing it

1. Switch the flag off, then run the migration's `down()` (`cli-migrate.ts rollback`), or drop the three tables.
2. Delete this folder, `packages/web/src/factory/`, the migration file and the test files
   (`tests/unit/factory-*.test.ts`).
3. Revert the hooks listed above: each is a few lines that mention `factory`. The optional model of a workflow-step
   execution does not; it can stay, since it changes nothing while unset.

## Not covered by tests

The engine, what the module hears from the rest of Fleex, the stats and the SQLite store are tested
(`factory-engine.test.ts`, `factory-module.test.ts`, `factory-stats.test.ts`, `factory-store-sqlite.bun.test.ts`). The Supabase store and a real agent run through a station are not: they need a
live database and an API key. So the cost figures have only been checked against made-up executions.
