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

An agent or skill station can run on another model than its persona's (`model` on the station; a skill's persona is the
one the skill belongs to).

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

## Desks: where a ticket is born

A **desk** (`kind: 'desk'`, Build › Area › Desk) is where a ticket is created on the floor itself, never through the
Work view. It was picked on `docs/factory/intake.html` (I1 for its look, N3 for how it is reached): a loading dock of
3 by 2 tiles, green, a badge with a plus, "NEW TICKET" over its name.

- **New ticket** on the command card (T, at the end of the first row with nothing selected) opens the creation form
  on the desk selected, else on the floor's first desk; with no desk on the floor the ticket is handed over without
  a target and lands in Inbound. A desk selected has New ticket where a zone has Release. Out of build mode a
  double-click on a desk opens the form too; its settings are Edit.
- The form is the Work view's whole new-task flow (`NewTask`, mounted by `FactoryDeskForm.tsx`): a title, a link that
  is recognised and imported, or a source to browse (GitHub issues and pull requests, Slack), then the composer. It
  runs on a draft of its own (`NewTaskDraftProvider`), so the Work view's draft is left alone; `onCreated` replaces
  opening the ticket in the Work view, and an import that already has a ticket opens that one in the workbench
  (`onOpenTicket`). A desk's `defaults` (board, type, priority) prefill the draft; the rest is as it is.
- Once created, the ticket is handed over to the Factory at the desk (`POST …/transfer` with the desk's id). It is
  released at once: the first arm that wants it takes it out. Nothing else can put a ticket into a desk (a drop, a
  move, an arm, a belt): `canTake` is false for it, and `transfer` is the only way in.
- Being born at a desk sets nothing on the ticket: its status is the form's (`doing`), its fields what was chosen.


## Items, and the intakes they come in by

An **item** is a conversation that came in from a source (Slack, Gmail, GitHub, or made by hand) and may ask
something of the owner. It is not a ticket: it has its own table, `factory_items` (migration 046), one row per
conversation, keyed by its source and its key there (`source_key`), and becomes a ticket only when a machine makes it
one (not built yet). Its content is not copied: a title, who it is from, a few lines (`excerpt`) and a link back.

- **On the floor** an item travels as a ticket does (belts, arms, zones, teleporters), saved in its own row
  (`machine_id`, `state`). Arms see it with the type `src:<source>` and the tag `source:<source>`, so a condition
  routes it. What only a ticket has is skipped: no status is set, a gantry leaves it untouched, no run row is written,
  a station sets it aside ("Stations do not work on items yet"), and **an exit archives it** (soft delete,
  `archived_reason = 'exit'`). Archive (the command card, its card on the floor) archives it as junk; Give back does
  the same. It is never listed among the tickets the rest of Fleex leaves alone (`managedIds`).
- **An intake** (`kind: 'intake'`, Build › Area › Intake, picked on `docs/factory/intake.html`, I1) is a dock of 3 by
  2, one per source. Items come in through `POST /api/factory/items` (`FactoryEngine.ingest`): what the sources'
  connectors will call, and what its popup's "Make an item by hand" calls until they exist. A new conversation one of
  its **rules** recognises (a field, From, Title or Title or text, contains a text) is **dropped**: saved archived with
  the reason `dropped`, counted, and it never reaches the floor. Otherwise it waits in the intake **while its
  conversation moves**, and is let out once it has been quiet for the intake's delay (`quietSec`, two minutes unless
  said); an arm then takes it. A new message on a known key updates the item where it is (in its intake, it waits
  again); an archived item comes back to its intake. Nothing on the floor can put anything into an intake.
- **On the page** desks and intakes are one view of the scene (`DockView`, `dock` in `scene.ts`) that each skin
  paints (`dock` in `skins/fleex.ts`, which Neon and the pixel skins inherit; seen from three quarters a dock stands
  0.375 tile high). An item is an object in relief, as a ticket is (`ticketToken.ts`), drawn from its source's mark
  instead of a type's icon, in its source's colour (`items.ts`); the pixel skins draw that mark as an eleven-pixel
  icon like a type's object (a solid shape in a one-pixel outline, one pixel of light), at any zoom, where a ticket
  would be a crate. A dock shows two of what it holds, far enough apart for those icons, then a count. The marks: four capsules in a pinwheel for Slack, an envelope
  for Gmail, a cat's head for GitHub, a written sheet for one made by hand. These marks recall the sources; they are not their logos.
  An intake shows its source's mark in relief on its badge, `HELD` (what waits for its conversation to be quiet,
  drawn faded in the dock) and `DROPPED` (over 24 hours). A click on an item opens its card beside it
  (`FactoryItemPeek.tsx`): source, author, messages, its lines, and Open in <source>, Release, Archive. Opening it
  (Enter, a double-click) opens its conversation where it lives: an item has no workbench.



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

## Areas

An area (`kind: 'area'`) is a part of the floor named as a place, "Build line", "Rework": a rectangle of whole
tiles, a name, a colour, and where its name is written (in a corner, or over or under it). It is decor. The engine
ignores it, it takes no tile (machines stand on it, as on a label), and nothing in the data links it to the machines on
it. Two areas nest or keep apart, never cross: one lies wholly inside the other or they do not meet (`normaliseLayout`
refuses a layout where two cross; the page refuses to draw, move, resize or paste one across another).

It is changed in build mode only (Build › Place › Area): a drag draws it, it is resized by its sides and corners,
moved by its name (a drag elsewhere on the floor stays the frame that selects machines, which never takes an area),
selected by a click on the floor where nothing stands, edited in its popup and removed like a machine; undo, copy and
paste work as for machines (`packages/web/src/factory/areas.ts`). Out of build mode it answers no click. The flat
skins paint it as a tinted slab bordered in its colour with its name on the floor; Pixel 3D raises it as a platform,
and what stands wholly on it with it.

## The decor

Each skin can give the floor a decor (`packages/web/src/factory/decor.ts`): a hall round what is built, a few tiles
off it, with a yard outside; on its top wall windows, a sign over what is built, a clock at the real time, a door,
notice boards; props on free tiles (a tile off every machine, never in an area); trees in the yard. It is generated
from the layout and a seed per tile, so it is the same from one visit to the next and moves when the floor does;
nothing of it is kept or answers a click, and props fade in build mode. The pixel skins draw it in pixel art, Fleex's
skin as an architect's plan, the neon one in lit tubes. A switch under the skins in Settings › Appearance turns it on
or off for the skin in use (`factoryDecor` in the settings, skin by skin): on by default for Pixel and Pixel 3D, off for
Fleex and Neon. The server knows nothing of it.

With the decor come the people (`packages/web/src/factory/people.ts`): a few walkers about the hall on the free tiles,
a reviewer who comes in by the door to wait at the foot of a gate that waits for a decision, and at each station that
runs something a worker who does what it does: works, raises a hand under "!" (its run failed) or "?" (the agent
asked), waits, or sleeps. They carry nothing, take no tile, answer no click, follow the floor's clock, fade in build
mode, and stand still for whoever asked for less motion.

## Plans

A workflow can be put down on the floor as a plan (Build › Import plan): `packages/web/src/factory/workflowPlan.ts`
turns a template into machines (a station per step, an arm per way out, the belts between them, bridges where they
cross, a zone to come in by and one to gather in) and says what it could not carry over. It is a conversion made in the
page, placed like anything pasted: the workflow is not changed, nothing links the two afterwards, and the server knows
nothing of plans. A step that branches on one field of its own output keeps those values as outcomes; other conditions
cannot be evaluated by arms, so the outcomes are named after the ways out and the plan says so. Sub-workflows, routing
steps and native actions other than a status change have no equivalent yet.

## The command card

The commands of the page are a grid of five columns by three rows (`packages/web/src/factory/menu.ts`), organised as
menus that open sub-menus: Factory, then Build, then Move, Station or Place. Three levels at most. A command is found
by its place, and its key is its place: the grid lies on the keyboard, the top row of letters for the first row, the
home row for the second, the bottom row for the third (`keys.ts`). A key is bound to where it is, not to what it
types, so the command at the top left is under the same finger on any keyboard; the tile prints what that key types
(A Z E R T on a French keyboard, Q W E R T on an English one). The layout is read from the browser when it says,
else seen in the first letter typed on a key the two disagree on, else guessed from the language; a click on its name
in the card's header forces the other one.

The bottom row never moves: Undo and Redo first in build mode, Next fourth on the floor, and last the way in and
out (Build, Done, Previous, Cancel), so one key enters build mode and leaves it. Fit is fourth in the middle row of
every menu, which is F on any keyboard. The card's head fills the room over the grid, under the cut corner: where one is, in
the middle and large, and the keyboard as it was read, aside. Some commands also answer to a named key: Escape for the way back, Delete to
remove, Tab for the list of tickets, N for Next. Copy, cut and paste are on the keyboard only, and a click or a drag
selects: none of them takes a place on the card. A label is one or two short words and is never cut.
`factoryMenu.test.ts` holds every menu to these rules.

With nothing selected the card has **Limits** next to Stats: the floor's two run limits, runs started per hour
and runs in flight at once, in a popup of their own (`FactoryLimits.tsx`; the same fields close the Stats popup). The
console shows where the floor stands against each ("running 1/3", "runs this hour 4/20").

The console is not a straight bar (`hudShape.ts`): the block of the minimap and the block of the command card stand
taller than its middle, their inner top corners cut, and the floor shows in the notch between them. The page gives
the console the height of its middle; the two side blocks rise over the foot of the floor's view.

The console stands over the floor instead of lying flat on it: it casts a shadow on the floor along its whole
contour (`FactoryHudShadow.tsx`: one still shape under the console, blurred once, deep on a dark theme and light on
a light one, so nothing in the console is filtered), its top edge is a line stronger than a border, and its surface
is a little lighter at the top on a dark theme.

- **The block of the minimap is one instrument** (picked on `docs/factory/minimap.html`): the map is a framed
  screen, the four toggles are tabs on its top edge, the five layers a column of buttons on its right edge (each
  with its name in a tooltip), the zoom a small group in its bottom corner. The map frames what is built and the
  view's rectangle, not the floor's margins, on a faint quadrille of terrain; under a layer, stations and zones take
  the colour of their reading and the rest goes grey, and the layer's name is written in a corner of the screen.
- **Over the minimap**, the time it is, to the second.
- **In the notch**, the saved selections (`Groups` in `FactoryHudBits.tsx`): ten places that never move, Shift+1 to
  Shift+0 to save. The digit selects what was saved; pressed again while it is the selection, it centres the view
  on it, as in a strategy game. A place shows only once something is saved in it and is always the same
  size: its key, an icon, and a ticket's number or how many things it holds. Pointing at one says what it holds.
- **In the middle**, what is selected. Several things show as one icon each (`Units`): pointing at one says what it
  is, a click keeps only it, Shift and a click take it out. Twenty-four at once, the rest as pages.
- **Against the command card**, a portrait of what is selected (`FactoryAvatar.tsx`): the factory with nothing
  selected, a work site in build mode, a ticket as its own object, large and gently tilting before a glow of its
  colour, a machine as what it does, a stack with a count for several things. It gives way when the middle is narrow.

The console can be put away to give the floor the whole page: a handle at the end of the notch, or U. The handle
is all that stays, at the foot of the floor; the keys of the command card still work. The choice is kept in the
browser (`viewToggles.ts`).

Shift adds to a selection (`addTo` in `pick.ts`): Shift and a click add a machine in build mode, a ticket out of it,
or take it out when it was already selected; Shift and a frame add what the frame takes; Shift and a click on bare
floor leave the selection as it is.

Build mode says so all round the view (`FactoryBuildFrame.tsx`): hazard tape, yellow and black on the diagonal like
the bay of what is set aside, and a plate in the corner, "BUILD MODE, the floor keeps running" (or "the floor is
stopped" under the emergency stop). It is laid over the floor and takes no pointer event. The tape follows the
console's contour while the console is shown, steps and cut corners included, and is a plain frame when it is put
away (`tapeShape`): a shape measured from the view's own edges, so nothing has to be measured.

## Light themes

The floor's colours were picked on a dark floor, where they are light: the hues of the station kinds, the paint of
zones, the pastel inks of plates. On a light theme (`isLight` of the floor's colour) the renderer keeps the hues and
changes what they are written with (`legible` in `floorLook.ts`): an ink that would not read on a light ground is
darkened, the lighter the more, until it does; `floorLook.test.ts` holds every hue of the floor to a contrast of 4.5
on a light body. The near-black plates of labels turn light, with a hairline, and the tags of arms become light
plates tinted with their colour. The places of a station are a faint shade instead of a deep hollow. What is paint
and not text keeps one colour on any theme: the hazard yellow of the build tape, of the toggles and of what is set
aside, and the three lights of a station's lamp. A theme's warning colour is a text colour, brown on a light theme:
gates are drawn in amber there. Nothing changes on a dark theme.

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
  dashed line, three corners. What it says is stencilled: its name, a padlock (shut and red: nothing leaves without you; open
  and green, with chevrons: it lets tickets out by itself), and how many tickets it holds as a large figure on the ground, under
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
  needs, and what it did with its latest runs; a zone its settings and its tickets; an arm, an exit, a label or an area, which
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

Everything lives here, in `packages/web/src/factory/`, and in four tables created by migrations `045_factory`
(`factory_floors`, `factory_tickets`, `factory_runs`) and `046_factory_items` (`factory_items`). No existing table is altered: a ticket is "handed over" when it
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

### What it reads, and how often

The floor moves in memory: the 250 ms tick, `GET /api/factory/state` (the page polls it every 600 ms),
`/api/factory/managed` and the checks the rest of Fleex makes (`refusesWorkflow`, `launchedByHand`) never query the
database. With the flag off nothing is read at all, not even the floor. What does reach the database:

- at the first tick with the flag on: the floor, its tickets, the runs left running, the runs of the last hour;
- every 2 s, only when something moved: one upsert per ticket that changed machine or phase (not per tick), never two
  writes in flight;
- every 30 s: every ticket of the floor re-read through the ticket store, 8 at a time, a sweep never doubled. A ticket
  changed in Fleex (`ticket.updated`, `moved`, `blocked`, `favorited`, `deleted` and their opposites) is re-read at once
  by its event; the sweep is the safety net, mainly for archiving;
- each station run: its row in `factory_runs`, start and end, beside the usual execution log;
- the page, while open: the stats every 30 s (cached 20 s on the server: runs of the period, then the executions of
  the tickets that ran, 8 at a time), a machine popup's runs every 4 s, a ticket's thread every 3 s.

## Hooks in existing code

| File | What |
|---|---|
| `infrastructure/migrations/index.ts` | registers `045_factory` and `046_factory_items` |
| `infrastructure/adapters/storage-factory.ts` | `factoryStore` per driver |
| `infrastructure/container.ts` | builds the module, exposes `container.factory` |
| `main.ts` | registers `/api/factory/*`, starts and stops the engine |
| `application/ports/config.port.ts` | `factoryEnabled`, `isFactoryEnabled()` |
| `infrastructure/http/focus.routes.ts` | a Factory-managed ticket is not listed as `idle` |
| `application/use-cases/execute-agent.ts`, `services/step-executors/{types,agent-step-executor,skill-step-executor}.ts` | an optional model for one workflow-step or skill execution (`model`, `modelOverride`): unset by workflows, set by an agent or skill station |
| web: `components/ui/Modal.tsx` | a dialog leaves Escape to a popover opened from it (a general fix, found with the ticket list's filters; it can stay) |
| web: `components/ui/Modal.tsx` | three opt-in props for the Factory's popups: `variant="glass"`, `flush` (no padding), `guardEscape` (Escape stays in a field, and is left to what is opened over the dialog). Unset, a dialog is unchanged; they can stay |
| web: `uiStore.ts`, `RouterSync.tsx`, `MainPanel.tsx`, `AppLayout.tsx`, `NavSidebar.tsx` | the `/factory` page and its nav entry |
| web: `SettingsPanel.tsx`, `settingsStore.ts` | the switch |
| `application/ports/config.port.ts`, web: `settingsStore.ts` | `factorySkin`: how the floor is painted, read by the page only |
| web: `components/settings/AppearanceTab.tsx` | one line to mount the choice of skin under the theme |
| web: `public/fonts/` | the pixel skin's fonts and their licences (Silkscreen, Pixelify Sans, SIL OFL); only the Factory under the pixel skin loads them |
| web: `lib/themes.ts` | `themeVars(theme)`: the CSS variables of a theme, which `applyTheme` sets on the root; the Factory sets those of a night theme on its own page under the neon skin. Pure, it can stay |
| `application/ports/config.port.ts` | `namedActions`, and `actions` in a repository's config: the named actions script stations run |
| `infrastructure/container.ts` | gives the module the host's shell and where a ticket's workspace and worktrees are (`host`), for script stations |
| web: `SettingsPanel.tsx`, `repository-dashboard/RepoConfigPanel.tsx`, `settingsStore.ts` | one line each to mount the list of named actions and a repository's commands for them; their two fields in the settings type |
| `application/use-cases/create-workflow-run.ts`, `domain/errors.ts`, `infrastructure/http/error-handler.ts`, `application/domain-event-listener.ts` | an optional `refuses(ticketId)` asked before a run is created, its `WorkflowRefusedError` (409), and the mention that asked for it closed |
| `infrastructure/http/tickets.routes.ts` | a comment that asks for a workflow on a ticket of the floor is refused before it is written |
| `infrastructure/http/skill.routes.ts`, `panel.routes.ts` | a skill or a panel launched by its button tells the Factory (`launchedByHand`) |
| web: `work/WorkView.tsx` | an `embedded` prop that leaves out the queue column, for the workbench |
| web: `work/timeline/buildTimeline.ts`, `TimelineGlyph.tsx`, `useTicketTimeline.ts` | a run a station started goes by the station's name on a ticket's timeline, with the Factory's glyph, instead of "Workflow": an optional `stationRuns` source (read by `useFactoryStationRuns`, empty while the Factory is off) and a `factory` glyph |
| web: `work/panel/ContextPanel.tsx`, `work/task/TaskPane.tsx` | one line each: the Factory group of Context, and what the floor asks at the foot of the thread |
| web: `work/new/newTaskDraft.ts`, `NewTask.tsx`, `NewTaskEntry.tsx`, `SourcePicker.tsx`, `NewTaskCompose.tsx` | the new-task screens read their draft and their Cancel from `useNewTaskDraft` (the Work store's, unless a `NewTaskDraftProvider` gives another), and `NewTask` takes an optional `onCreated` and `onOpenTicket`. Without a provider or those props, the Work view is unchanged; they can stay |

## Removing it

1. Switch the flag off, then run the migrations' `down()` (`cli-migrate.ts rollback`, 046 then 045), or drop the four tables.
2. Delete this folder, `packages/web/src/factory/`, the migration file and the test files
   (`tests/unit/factory-*.test.ts`).
3. Revert the hooks listed above: each is a few lines that mention `factory`. The optional model of a workflow-step
   execution does not; it can stay, since it changes nothing while unset.

## Not covered by tests

Drawing the floor is two things. The scene (`packages/web/src/factory/scene.ts`) says what is shown at each frame and
where, with no paint: every machine with its state, its places and what they hold, its quays, its plates' words, every
ticket where it is drawn, every arm where its cup is. It keeps what moves from one frame to the next (tickets easing
towards where the server says they are, riding the belts, carried by cups, sliding to quays, leaving by exits, jumping
between teleporters), and is tested (`scene.test.ts`). A skin (`skins/`) paints that scene and keeps nothing of the
floor: sizes, colours, fonts, and what is left out from far are its own. The view (`renderer.ts`) holds the camera, says
what is under the pointer, and at each frame builds the scene, gives it to the skin, and paints the pieces the skin
returns in their order (`order` in `skins/skin.ts`: by layer, floor then what stands then what is overhead, by depth on
a layer, and what is carried just after what carries it). See `docs/factory/skins-handover.md`.

The skin is chosen in Settings › Appearance, under the theme (`factorySkin` in the settings, `FactorySkinPicker.tsx`,
shown only while the Factory is on): one card a skin, each with a made-up floor painted live by the real renderer in
that skin and the theme in use. There are four (`skins/index.ts`):

- **Fleex** (`skins/fleex.ts`), the default: the floor as it has always been drawn, following the theme. A flat skin:
  everything on one layer, its depth the order the floor has always been painted in.
- **Neon** (`skins/neon.ts`), chosen on `docs/factory/skin-choice.html`: Fleex's shapes on a night floor whatever the
  theme, every line glowing. It takes the theme's accent, lifted until it shines on the night (the chevrons of the
  belts, the Inbound, what is selected). The glow is one picture: once all is painted, a quarter-size copy is blurred
  and laid back over it, before the words, so it costs the same however large the floor. The page around the floor
  (header, console, minimap, what lies over the floor) takes the skin's colours: the CSS variables of a night theme
  made from the theme in use (`nightTheme`, set on the page's own element through `themeVars`), and a monospace
  font. Popups, which open over the whole app, keep the theme. `neon.test.ts` holds every ink of the floor and of
  the page to 4.5 on every ground it is written on, for every built-in theme.
- **Pixel** (`skins/pixel.ts`), chosen on `docs/factory/pixel-flat.html`: a workshop in pixel art, by day on a light
  theme and at night on a dark one, the theme's accent made to read on it. The same painters as Fleex, painted at
  16 art pixels a tile and enlarged without smoothing; the words are written crisp after, in pixel fonts (Silkscreen,
  Pixelify Sans) that Fleex serves itself (`packages/web/public/fonts`, under the SIL Open Font License, declared in
  `skins/pixelFonts.css`). Its own drawing: a floor of tiles, flat bodies with a thick outline in their kind's hue,
  hard shadows, tickets as crates in the colour of their type, and a worker at the foot of
  each station that runs something, busy while a ticket runs there. Workers are procedural: drawn from the scene at
  each frame, kept by no one. The light of a lamp that needs someone (or is off) is solid rings round its station,
  paler the farther they are, that flicker a few times a second: the rings breathe, their tint shifts, a few pixels
  flare, at random from the station and the moment, so nothing is kept; it stands still when the floor does. The page
  around the floor is painted in the same workshop (`workshopTheme`), in
  Pixelify Sans; `pixel.test.ts` holds its inks as the neon's are held.

- **Pixel 3D** (`skins/pixelTq.ts`), chosen on `docs/factory/pixel-3q.html`: the pixel workshop seen from three
  quarters. Every machine keeps its tiles, where its shadow and feet are, and its top is painted higher by a height of
  its kind (a station half a tile, a belt or a bridge a quarter, a teleporter an eighth; zones and exits are paint on
  the floor), its front face filling the gap. What stands is painted by depth (the foot of its tiles: lower on the
  screen passes in front), what is overhead (arms with what they carry, gantries, tolls) after it, what is carried
  just after its carrier, at its height (`order` in `skins/skin.ts`); words and plates rise with what they are written
  on. A ticket hidden behind a station of the row below has its outline drawn through it. Build mode goes flat:
  things are placed on tiles, seen from above. A platform raises what stands wholly on it (none yet: see lot 8 in
  `docs/factory/skins-handover.md`).

A skin seen from three quarters says how high it paints each machine (`liftOf` on `Skin`). The view then answers
for what is seen: a click hits the top or the front face of a machine, the nearest first (`pick`); a ticket is where
it is drawn, as high as what carries it, for a click, a frame dragged over the floor, the card beside it and the
names over it (`ticketPos`, `ticketPlaces`, `anchorOf`). What is dropped (a ticket let go, a machine placed, a ghost)
stays on its tiles.

A skin may give the steps its zoom rests on (`steps` on `Skin`): the pixel skin's pixels are whole only at 16, 32,
48, 64 and 80 pixels a tile (and it does not pixelate at 4 and 8, from far). The view then zooms by steps
(`FactoryView.wheel`, `zoomAt`, `glide`): a notch of the wheel, or a click on the zoom buttons, sends it to the next
step, it glides there and lands exactly on it; whatever puts it elsewhere (a jump to a ticket, a paste) glides to
the nearest step; framing picks the closest step that still shows everything. It never rests between two. Other
skins zoom freely.

How the floor is painted is checked by eye, in a browser against a made-up server: what is tested is the scene and the
geometry and the sorting it draws from (`quays.ts`, `machineArt.ts`, `armRules.ts`, `ticketMotion.ts`).

A change to the renderer that should show nothing is checked picture against picture. `packages/web/src/factory/shots/`
is a made-up floor with one of everything (each kind of station in each state, zones, belts that bend, run fast and
cross, gantry, toll, arms, teleporters, an exit, tickets in every phase, one leaving and one jumping), painted the same
frames each time in eleven situations: dark and light themes, close and far, build mode, a lens, the emergency stop.
From `packages/web`, `node scripts/factory-shots/run.mjs shoot <dir>` saves them, on `main` and on the branch, and
`node scripts/factory-shots/run.mjs compare <a> <b> [diff]` says which differ, by how many pixels, and paints where.

The engine, what the module hears from the rest of Fleex, the stats and the SQLite store are tested
(`factory-engine.test.ts`, `factory-module.test.ts`, `factory-stats.test.ts`, `factory-store-sqlite.bun.test.ts`). The Supabase store and a real agent run through a station are not: they need a
live database and an API key. So the cost figures have only been checked against made-up executions.
