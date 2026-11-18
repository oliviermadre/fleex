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

The engine moves things four times a second and the page reads the floor every 600 ms, while it draws sixty times a
second. So what moves is not drawn where it was last said to be, which would stand still and jump: an arm keeps turning
at its own pace (`armMotion.ts`), and a ticket on belts follows what was last said along the belts themselves, at their
pace, a fraction of a second behind (`ticketMotion.ts`; the snapshot carries `beltSpeed` and `fastBelt` for it).

An agent station can run on another model than its persona's (`model` on the station).

When a station's agent asks a question instead of answering, the ticket waits in the station, pulsing with a "?".
It leaves only by an arm filtered on the reserved outcome `question` (an unfiltered arm leaves it alone, so an
unanswered ticket never carries on down the normal path). A Factory run creates no mention and no workflow step run,
so the ticket view's usual cards never see it: a card at the foot of the ticket's thread says it waits for you and
carries the action (Run again, the gate's outcomes). Replying to a question gives the ticket back to the station that
asked it (see "In the Work view").

The floor grows with what is built: it is what is built plus a margin, so there is always room to extend it. In the
page it is the map, as in a strategy game: it takes the shape of the view, the view cannot zoom out past the point
where the floor fills it nor move beyond the floor's edge (`FactoryView.constrain`), and the minimap's frame never
leaves the minimap.

Moving the view is the same in build mode and out of it: Space and a drag (or a drag with the right button), the arrow
keys, the minimap, and the edges of the page (`edgeScroll.ts`). Within 50 px of an edge (against the app's navigation,
under the top bar, at the right and at the bottom of the window, under the console) the view glides that way, faster
the closer the pointer is, and the pointer turns into an arrowhead towards the edge; not while it is over a control.
A plain drag never moves the view: it is for tickets and machines.

Out of build mode a drag that starts anywhere but on a ticket draws a frame, and the frame takes tickets only
(machines are selected in build mode, where the same drag takes them). While it is dragged, the tickets inside it are
ringed in its colour: what is ringed is what will be selected (`pick.ts`). Several tickets selected together have their
own menu on the command card, each command where a single ticket has it (Release, Run again, Star, Give back, Set
aside), acting on those of them it applies to; giving several back is asked first. Dragging one of them moves them
all, into a zone, a station or an exit.
Where two belts must cross, a **bridge** tile carries each ticket straight across. A bridge has no direction of its
own: a ticket crosses it the way it arrives, in any of the four directions, on the east-west lane or on the north-south
one. The page draws each lane the way the belts (or the arm) that feed it send tickets across.

A **fast belt** (`fast` on a belt) carries a ticket twice as fast (`FAST_BELT`). It is laid like a belt (Build › Move ›
Fast belt); laid over belts already there, it speeds them up, and belts selected in build mode are sped up or slowed
down from the command card. It shows its speed three ways: its chevrons come in pairs, in blue, and run twice as
fast; its rails are blue too, which reads from far and on the minimap. A bridge has no speed of its own either: each
lane goes at the speed of the belt that feeds it (fed by an arm, of the belt it leads to), in the engine (`fastLane`)
and on the page (`bridges.ts`), where that lane then looks like a fast belt while the other keeps its own look.

In build mode every change to the
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
with an icon for what it is, a light, as many places as it works on tickets at once (six at most), and a hatched bay
for what is set aside. What is done has no tray: it goes to a quay (see "Quays, arms, zones and exits" below). It takes
5 by 4 tiles (the engine accepts 3 by 3 to
8 by 6). The light says: red the machine is off, green it is on, amber it is on and something in it is set aside; on a
gate, amber while something is to decide. On a machine that runs something it is the switch: a click turns it off or
on, and pointing at it says what runs, what is set aside and whether the exit is clear. The floor's glow follows the
light: amber around a machine that needs someone, a dimmer red around one that is off.

The four kinds that run something are told apart at a glance, as a gate is by its dashed amber edge (`KIND_LOOK`,
`bodyOf` in `machineArt.ts`). Each has a hue for its edge and its badge, its word over the name, and a body of its
own: an agent is violet, with round shoulders and an antenna; a skill is blue, with cut corners; a panel is orange, a
stack of three plates; a script is lime, a terminal window with its title bar. A free place says faintly what will
work there (a robot's head, a tool, three seats, a prompt). Seen from far the word goes and the shape and the hue
remain; the minimap paints each station in its hue. A panel's parts stand on its front plate and a script's under its
title bar, so both have a little less room than the other two.

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
by its place: in every build menu Undo, Redo and the way back sit in the same slots. Copy, cut and paste are on the keyboard
only, and a click or a drag selects: none of them takes a place on the card. A
label is one or two short words and is never cut. `factoryMenu.test.ts` holds every menu to these rules.

## Reading the floor

Every station visit is a row in `factory_runs`; a ticket reaching an exit leaves one too (executor `exit`, from
hand-over to exit, which is the lead time). `GET /api/factory/stats?days=7` turns those rows into figures per machine
(`stats.ts`, a pure function): runs, failures, questions, outcomes, average run time, time spent waiting for a human
(a gate's decision; a question until the ticket's next run) and cost. A run is priced by the agent execution it
started; a panel starts one execution per persona and links only its synthesis, so a panel run also takes the
ticket's other executions started while it ran. The route only reads, and its result is kept 20 seconds.

On the page, four layers tint stations and zones (what stands there now, cost, run time, human wait; chosen next to
the minimap), and the figures themselves are read in the sheets described below.

## The floor itself

Out of build mode the floor is dressed (`packages/web/src/factory/floorLook.ts`): a dot where tiles meet instead of
lines, a soft light over the middle, a shadow under each station, and around a station the glow of its
lamp while it works (green), waits for a decision or an answer (amber) or has a failed run (red). The glow is the
station's own state bar shining on the floor, nothing more; under a layer it is off, since colour there is the layer's
reading. Build mode keeps plain lines and no light: that is the drawing one places machines against. The Grid toggle
hides the dots as it hid the lines. Light and glows are painted on a canvas of their own, redone only when the view,
the floor, the theme or a station's state changes, so their cost does not grow with the number of stations lit.

## Quays, arms, zones and exits

How these four are drawn was chosen on mock-ups first (`docs/factory/looks.html`, then `docs/factory/looks-2.html`).
Nothing of it is in the engine or in the layout: it is the web renderer reading the same snapshot.

- **A quay per arm** (`packages/web/src/factory/quays.ts`). Arms stand anywhere round a station, so what is done is
  not kept in one tray for all of them. Each arm that takes from a station has a quay, a notch in the station's edge
  on the tile the arm reaches; a ticket that is done slides to the quay of the arm that will take it, and waits in
  line there. Which arm that is, is decided as the engine decides it (`wants` in `armRules.ts` mirrors the engine: a
  conditional arm takes what its conditions hold for, a plain arm what the others leave). A ticket no arm takes will
  not leave by itself: it goes to a tray marked "NO ARM", in red, which is there only then. A question taken by an
  arm that asks for questions stands at that arm's quay, not in the bay. The same holds for a zone: a released ticket
  stands at the quay of its arm, a dashed square painted on the zone's edge.
- **An arm** is a base, a flat link and a suction cup. The cup goes where the ticket is: over the middle of a belt's
  tile, over the quay of a station or a zone, so its reach changes while it turns and it lifts what it is on; what it
  carries moves with it. Its colour is its band and its base: grey when it has no condition, amber when it has some,
  or one of sixteen picked in its popup (`color` on the arm, `#rrggbb`, kept by the engine as paint and nothing
  more; `PALETTE` in the web `types.ts`), so that the arm that takes what failed can be red. Its quay, its tag and
  the arrow under it take the same colour. Under it, painted on its own tile, an arrow in that colour says which way it works: narrow where it takes, wide
  where it drops, its head at the edge. In build mode, an arm that is selected, or in hand before it is put down,
  shows the tile it takes from (blue, dashed, "TAKES FROM" and what is there) and the tile it drops on (green, "DROPS
  ON"), and that R turns it.
- **A zone** is paint on the floor, in the colour of the status it sets (the accent for the intake): a faint fill, a
  dashed line, three corners. What it says is stencilled: its name, a padlock (shut: nothing leaves without you; open,
  with chevrons: it lets tickets out by itself), and how many tickets it holds as a large figure on the ground, under
  them. A zone that releases by itself and sets "todo" stops while too many tickets are in work on the floor: that
  limit is the line along its bottom, which fills with the tickets in doing or reviewing (not with what the zone
  holds), amber from four fifths, and says "IN WORK 4/5".
- **An exit** is a frame of light that holds nothing: a ticket that reaches it is handed back to Fleex. So it is seen
  leaving: when a ticket that was on a belt or in an arm leading into an exit is gone from the snapshot, it is drawn
  a moment longer, up to the frame as it was, then as an outline with a tick that fades towards the middle while the
  side it came in by lights up. (A ticket that goes from anywhere else was taken back, and just goes.) The exit carries
  how many tickets left by it over the period of the floor's figures: `exits` in `GET /api/factory/stats`, a count
  per exit, to which the page adds what it has seen leave since it last asked.

## Tags of the form key:value

A tag written `key:value` gives a ticket one value for that key (`tags.ts`, the same file on the server and on the
page). Setting `type:major` replaces `type:minor`; a key can be counted on (`passes:2`), from nothing; a plain tag is
left as it is. An arm has a condition for it, **Tag value**: a key, an operator and what to compare to (`passes > 3`).
The two are compared as numbers when both are, and a ticket that does not have the key counts as 0, which is what a
counter that has not started is. Otherwise they are compared as text, where only "is" and "is not" mean anything.

Nothing is stored anywhere else: these are the ticket's own tags, seen and filtered as such in the rest of Fleex.

## The Set gantry

A gantry over a belt tile that sets things on every ticket that goes under it, with no agent: status, priority,
type, complexity, board, favourite, blocked, and tags (add, remove, set a `key:value`, add 1 to a key, remove a key).
It is not a machine of its own: it is `set` on a belt (`set-ops.ts`), so a ticket never leaves the line for it, and
everything that is true of a belt (direction, speed, bends, bridges) stays true.

The order matters, and is kept by the engine (`underGantry`): the ticket stops in the middle of the tile, the changes
are applied to the engine's own copy and written on the ticket by the ordinary path (`applyChange`, which is
`ApplyTicketMutationUseCase`: a status is a move, the rest are fields), and **the ticket only goes on once that write
is confirmed**; what the engine knows of the ticket is then read again. So whatever looks at the ticket next sees what
was written, and the engine's periodic re-read cannot bring an older value back. A write that fails keeps the ticket
under the gantry, which says so in red and tries again every few seconds. A ticket the gantry has dealt with is
marked (`released`), so a restart of the server does not count it twice.

On the page it is two posts and a beam, with a plate beside it that lists what it does, one operation a line: its
setting is read from the floor. It is placed from Build › Station › Set, on a belt that is there or with a belt of
its own, and its popup edits the list.

Only what cannot fail is here. Attaching a worktree or a pull request can fail, so it needs a station with two ways
out: that is not built.

## The toll

A toll is the Set gantry with something to reject: `toll` on a belt, next to `set`. It is one component: placed
(Build › Move › Toll), moved, copied and set up as one, in one popup.

Once the gantry has done its work on a ticket, and that is written, the toll tests the ticket against its conditions.
They are an arm's conditions, **any** of which is enough. A ticket that is rejected is taken off the belt by the
toll's own arm, a short red arm on the edge of the tile, and put on the tile next to it on the side it was told
(`out`, always across the belt: it turns with it). What is not rejected goes on along the belt. While the arm
carries, the belt under the toll is free; if there is nowhere to put what it rejects, the ticket waits under the toll
and the line waits behind it.

Operations first, condition after: "add 1 to passes" then "passes is above 3" lets a ticket round a loop three times
and takes it out the fourth. The count is a tag on the ticket, so it is cleared by a plain Set gantry ("remove key
passes") put wherever the ticket should start again from nothing, on the way out of the zone where someone looks at
it for instance. Nothing resets by itself.

A toll with no operation is a plain filter on a belt ("reject when type is not build").

The engine keeps the toll's arm on the belt's own machine (`armState`, `item2`) and tells the page about it among
the arms, under the belt's id. A ticket in that arm is `arm` on the belt's id; after a restart it is back under the
toll, already dealt with, and is rejected again without being counted again.

## Named actions, and the script station

**Named actions** are actions that have a name of their own ("test", "lint", "build"), which each repository fills
in with its own command. The list is `namedActions` in the configuration, edited in Settings › General; a
repository's commands are `repoConfigs[<org/name>].actions`, edited in the repository's Config tab
(`packages/web/src/factory/NamedActions.tsx`, mounted by one line in each of those two screens, and shown only while
the Factory is on). A new action shows everywhere without touching what uses the others. Nothing but the Factory
runs them yet.

A **script station** (`exec: 'script'`, `script-runner.ts`) runs shell commands when a ticket arrives, with no agent.
It is not about testing in particular: it runs whatever it is given.

- It has an optional **default action**: with one, each repository of the ticket runs its own command for it; with
  none, the station runs only its own lines.
- It has **lines of its own**: for one repository, for any repository, or for the ticket's workspace (run once,
  whether or not the ticket has a repository; the workspace directory is created if it is not there yet). A line
  is a named action or a command typed in.
- For each repository of the ticket: its own line, else the "any repository" line, else the default action, else
  nothing to run.
- A command runs in the worktree, through the host's shell, with the ticket in its environment
  (`FLEEX_TICKET_NUMBER`, `FLEEX_TICKET_TITLE`, `FLEEX_TICKET_ID`, `FLEEX_REPO`, `FLEEX_WORKSPACE`), and a time
  allowed (300 s unless said otherwise).
- It concludes by itself, so its outcomes are not typed in: **ok** when every command exits with 0, **ko** when one
  does not (or runs out of time, or its worktree is not on disk). After a failure the others are run anyway, or
  not, as the station says. A repository it has nothing to run for is skipped, counts as a failure, or sends the
  ticket out by a third outcome, **unconfigured**, which the station then has: "the tests fail" and "I do not know
  how to test this" need not go the same way.

It is a station like the others that run something: places, a switch, tickets set aside. What failed, and the end of
what the command said, is kept on the run (its `error`), and shows in the station's latest runs. Two limits: a
command in progress is not stopped when its ticket is set aside or when the emergency stop is pressed (its result is
ignored, but it runs to its end); and the output of a command that succeeded is not kept.

## The emergency stop

One button, always in the page's header: **Emergency stop**. It is `halted` in the floor's settings
(`POST /api/factory/halt`, `setHalted` in the engine), so it survives a restart of the server.

On, the engine's tick does nothing: belts, arms, zones and teleporters stay where they are and no station starts
anything. Every run in progress is cut at once (its execution is cancelled, its run row says "Cut by the emergency
stop") and its ticket goes back in line in its station, in its place. People can still move tickets by hand, decide at
gates and build: what they do waits with the rest. On the page nothing moves either (chevrons, arms and rings stand
still) and a red notice says so. **Restart the floor** lifts it: everything carries on from where it stood, and the
tickets whose run was cut are run again.

It is not a pause to work in: there is no stepping, and no way to stop one line only (a station's own switch does
that).

## Teleporters

A jump across the floor, so that a ticket can be sent to another line without a belt running all the way there. The
concept was settled on a mock-up first (`docs/factory/teleport.html`).

A teleporter takes one tile and holds one ticket. It is a **departure** or an **arrival**, has a name, and can be
given one of the sixteen colours.

- A **departure** takes a ticket from an arm, a belt or a hand, one at a time, and leads to an arrival (`to`, that
  arrival's id). It sends its ticket as soon as that arrival is free. Without a destination (none chosen, or the
  arrival was removed, which the engine notices when the layout is saved) it keeps what it is given.
- An **arrival** takes nothing from the floor: an arm pointed at it never picks, a belt that leads into it holds its
  ticket at its end, and a ticket cannot be dropped on it by hand. It only receives from its departures, and an arm
  takes the ticket out, with its conditions as anywhere else.
- **Several departures can lead to one arrival.** While it holds a ticket they keep theirs; when it is emptied, the
  ticket that has waited longest in its departure goes first (`updateTeleporters`, once per tick).
- A ticket stays in view a moment (`TELEPORT_REST_MS`) in a departure before it goes and in an arrival before an arm
  takes it, so the page sees it there. A jump is not a run: nothing is written on the ticket, in `factory_runs` or on
  the timeline. In a teleporter a ticket's phase is `port`.

On the page (`packages/web/src/factory/teleport.ts` for what is decided, `renderer.ts` for what is drawn): a ring
where the ticket stands, four chevrons that go in on a departure and come out on an arrival, a frame that is closed
on a departure and open in the middle of each side on an arrival. The ring is amber dashes while a departure waits
for its arrival, and the pad is red when it cannot work: a departure with no destination, an arrival holding a
ticket no arm takes. A plate beside it carries its name and one line (where it leads, how many lead to it, or what
is wrong). Without a colour of its own a departure takes the colour of its arrival, so the two read as a pair. The
link between them is not drawn all the time: it shows for the teleporter that is selected or pointed at (for an
arrival, every departure that leads to it), and while a ticket crosses, with the ticket as a dot on it. An arm that
points into an arrival carries a no-entry sign, and in build mode says "NO ENTRY" where it would say "DROPS ON".

They are placed from Build › Move › Teleporter, as a departure; the popup sets the name, the role, the destination
(among the arrivals of the floor) and the colour, and an arrival's popup lists the departures that lead to it. Copied
with its arrival, a departure leads to the copy; copied alone, to the arrival it led to.

## What waits for someone

Out of build mode, the tickets that wait for someone are listed top-left over the floor (`needs.ts`,
`FactoryNeeds.tsx`): a decision at a gate, a question, a failed run, a ticket set aside by a human, one lying on the
floor; longest wait first, with what each is, where it stands and for how long. N goes to the next one and Shift+N to the one before
(**Next** on the command card, at the same place in every menu out of build mode); the arrows only ever move the view.

A click on a ticket, there or on the floor, opens its thread beside its machine (`FactoryPeek.tsx`): the whole
conversation, scrolled to its end, with the latest deliverables on top. What the ticket waits for is done from there:
a gate's decision with an optional reason, an answer (which gives the ticket back to the station that asked, see
"In the Work view"), another run after a failure. Enter, V or a second click opens the whole ticket; Escape closes the card.

## No side panel: the console, and popups

The floor takes the whole width of the page. Nothing of the Factory opens beside it.

- **The console** along the bottom says what is selected, read only (`FactoryConsole.tsx`): for a station whether it
  is running or stopped, its model and mode, its places, its outcomes and arms, and what it did over the period; for
  the floor, the tickets on it and what it did. The command card acts on it: a station that runs something is stopped
  and started there (Q), and **Edit** (V, at the place where a ticket has Open; also Enter or a double-click) opens
  its popup.
- **A machine's popup** (`FactoryMachinePopup.tsx`): a station shows its settings, the tickets it holds with what each
  needs, and what it did with its latest runs; a zone its settings and its tickets; an arm, an exit or a label, which
  have only settings, a small popup. Everything a machine has to be set is set there, in build mode or out of it. A
  belt and a bridge have nothing to set and no popup.
- **The floor's popup** (`FactoryFloorPopup.tsx`, **Stats** on the card when nothing is selected): what the floor did
  machine by machine, where tickets stand, and the safety limits.

The three popups and the workbench share one frame (`FactoryPopup.tsx`): Fleex's `Modal`, in the middle of the
window, with a bar along its top. It is of glass: slightly translucent, blurring what is behind it, over a backdrop
lighter than a dialog's and that blurs nothing, so the floor stays in sight around and under it. `Modal` got three
opt-in props for it (`variant="glass"`, `flush`, `guardEscape`); a dialog that sets none of them is unchanged.

## The workbench

Opening a ticket from the floor (Enter, V, a second click) brings up the Work view itself (`FactoryWorkbench.tsx`):
a popup over the floor, nearly as wide and as high as the window. It is `WorkView` with its queue column left out, on the ticket that was opened (the Work store's own
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

At the foot of that panel, above "Delete Ticket", is the hand-over (`FactoryHandover.tsx`): **Send to Factory** for a
ticket plain Fleex drives (it lands in the Inbound zone; a ticket that is done or cancelled cannot be sent), **Take
back from Factory** for one the floor drives (it leaves the floor at once and is an ordinary ticket again, in the
status it has; a run in progress is left to finish and its result is ignored). It is there for every ticket while
the Factory is on, and is the only thing of the Factory a ticket that is not on the floor shows.

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
| web: `components/ui/Modal.tsx` | three opt-in props for the Factory's popups: `variant="glass"`, `flush` (no padding), `guardEscape` (Escape stays in a field, and is left to what is opened over the dialog). Unset, a dialog is unchanged; they can stay |
| web: `uiStore.ts`, `RouterSync.tsx`, `MainPanel.tsx`, `AppLayout.tsx`, `NavSidebar.tsx` | the `/factory` page and its nav entry |
| web: `SettingsPanel.tsx`, `settingsStore.ts` | the switch |
| `application/ports/config.port.ts` | `namedActions`, and `actions` in a repository's config: the named actions script stations run |
| `infrastructure/container.ts` | gives the module the host's shell and where a ticket's workspace and worktrees are (`host`), for script stations |
| web: `SettingsPanel.tsx`, `repository-dashboard/RepoConfigPanel.tsx`, `settingsStore.ts` | one line each to mount the list of named actions and a repository's commands for them; their two fields in the settings type |
| `application/use-cases/create-workflow-run.ts`, `domain/errors.ts`, `infrastructure/http/error-handler.ts`, `application/domain-event-listener.ts` | an optional `refuses(ticketId)` asked before a run is created, its `WorkflowRefusedError` (409), and the mention that asked for it closed |
| `infrastructure/http/tickets.routes.ts` | a comment that asks for a workflow on a ticket of the floor is refused before it is written |
| `infrastructure/http/skill.routes.ts`, `panel.routes.ts` | a skill or a panel launched by its button tells the Factory (`launchedByHand`) |
| web: `work/WorkView.tsx` | an `embedded` prop that leaves out the queue column, for the workbench |
| web: `work/timeline/buildTimeline.ts`, `TimelineGlyph.tsx`, `useTicketTimeline.ts` | a run a station started goes by the station's name on a ticket's timeline, with the Factory's glyph, instead of "Workflow": an optional `stationRuns` source (read by `useFactoryStationRuns`, empty while the Factory is off) and a `factory` glyph |
| web: `work/panel/ContextPanel.tsx`, `work/task/TaskPane.tsx` | one line each: the Factory group of Context, and what the floor asks at the foot of the thread |

## Removing it

1. Switch the flag off, then run the migration's `down()` (`cli-migrate.ts rollback`), or drop the three tables.
2. Delete this folder, `packages/web/src/factory/`, the migration file and the test files
   (`tests/unit/factory-*.test.ts`).
3. Revert the hooks listed above: each is a few lines that mention `factory`. The optional model of a workflow-step
   execution does not; it can stay, since it changes nothing while unset.

## Not covered by tests

How the floor is painted (`renderer.ts`) is checked by eye, in a browser against a made-up server: what is tested is
the geometry and the sorting it draws from (`quays.ts`, `machineArt.ts`, `armRules.ts`, `ticketMotion.ts`).

The engine, what the module hears from the rest of Fleex, the stats and the SQLite store are tested
(`factory-engine.test.ts`, `factory-module.test.ts`, `factory-stats.test.ts`, `factory-store-sqlite.bun.test.ts`). The Supabase store and a real agent run through a station are not: they need a
live database and an API key. So the cost figures have only been checked against made-up executions.
