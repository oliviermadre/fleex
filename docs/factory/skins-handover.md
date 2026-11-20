# Factory skins, three-quarter view and lines: hand-over

Written at the end of the session that built PR #354 (Factory, lots 1 to 48), to start this work from a fresh
session once that PR is merged. Nothing described here is built.

Read first, in this order:

1. this document;
2. `docs/factory/skins.html`: one floor painted by five interchangeable skins, and the study of what making the
   Factory skinnable costs;
3. `docs/factory/pixel-3d.html`: the pixel skin seen from three quarters, with lines and aisles, drawn in four layers;
4. `packages/server/src/factory/README.md`: what the Factory is today.

The two mock-ups are built the way the real thing should be: one scene, painters that paint it. Their code is worth
reading, not only their pictures.

Under "Decided" is what the owner said. Under "Concepts" and "Proposed" is the previous session's opinion, which can
be overturned.

## Decided

1. **A skin is paint only, on a constant matrix.** Tile size, machine sizes, geometry, routing and clicks do not
   change from one skin to another.
2. **The pixel skin, with its decor**, is the one wanted. The decor is what makes the Factory a place ("the question
   of incarnation").
3. **A three-quarter variant of the pixel skin**: machines rise from their tiles, with their front face, their feet
   and their shadow, as if the camera were tilted.
4. **Lines are marked by platforms and guard rails** (L2 + L3 in `pixel-3d.html`). Floor paint (L1) was not picked.
5. **The neon skin is cheap**: a palette, thicker edges, a glow. It needs no new shape.
7. **The console takes the skin's colours** (open question 1, answered).
8. **The skin is chosen in Settings, as the theme is** (open question 2, answered): Fleex has one user, so it is a
   setting next to the theme, not a setting of the floor. A skin should follow the theme where it can (a pixel skin
   with a dark floor on a dark theme, the theme's accent where the skin has one): then the console taking the skin's
   colours stays in keeping with the rest of the app.
9. **Pixel zoom** (open question 3, answered): the zoom moves continuously but only ever stops on a step, where
   pixels are whole; never at rest between two steps.
10. **Sprites** (open question 4, answered): drawn by code. What they do is procedural and the page's own: where a
   worker stands is not kept by the server, and after a reload it may well be somewhere else.
6. **Working method, unchanged**: an interactive HTML mock-up drawn like the floor comes first for anything
   functional or visual, the owner picks, then "go build". One commit per lot. Replies to the owner in French,
   product text in English, never "..." in a wording.

## Concepts

### 1. The scene and the skin

`packages/web/src/factory/renderer.ts` (1 618 lines, some 40 drawing methods, some 200 canvas calls, 47 colours
written in it) mixes three things: what to show, where, and with what paint. A skin needs them apart.

- **The scene** is computed once a frame and is the same for every skin. For each machine: its rectangle in tiles,
  its state (on, off, waiting for someone, running), its places and what they hold, its quays, its plates and their
  words. For each ticket: where it is, what carries it, its state. For each arm: its angle and what it carries.
- **A skin** paints the scene. It has a floor, a decor, and one painter per kind of element: belt, fast belt, bridge,
  arm, station (agent, skill, panel, script, gate, status), zone, exit, teleporter, gantry, toll, line, ticket,
  plate, build tape, selection outline, ghost of what is being placed.
- **What a skin does not touch**: tile size, the geometry of parts (`machineArt.ts`, `quays.ts`, `bridges.ts`,
  `teleport.ts`), the words of plates, and the colours that carry a meaning (a ticket's type, a station's kind, the
  green, amber and red of a lamp). It may soften or brighten them; it may not replace them.
- **The console** (HTML) follows through CSS variables and one font per skin. Its contour and blocks do not change.

### 2. Depth and layers

Seen from three quarters, a single sort by depth is not enough. The mock-up showed arms sinking into stations,
tickets slipping under the next belt tile, and tickets lost behind a gantry. The rule that fixed it:

1. **The floor**: tiles, platforms' tops, zones, an exit's mat. Nothing passes in front of anything.
2. **What stands, by depth**: each piece has as key the foot of its footprint. What is lower on the screen passes in
   front. What straddles several heights is cut into pieces at their own depth: an arm's pillar, a gantry's back
   post and front post, an exit's posts, a guard rail's segments.
3. **What is overhead, after everything that stands**: arms' booms and cups with what they carry, gantries' bars,
   an exit's lintel, a teleporter's beam.
4. **The words**, over everything.

**What is carried follows its carrier.** A ticket has no depth of its own: it is drawn just after what carries it,
after the belts of its row or after its station. This was the main missing rule.

Each painter declares its pieces, their layer and what they carry; the drawing loop sorts. A flat skin has one
standing layer and nothing else changes.

Still open: when a station of the lower line hides a ticket of the upper one. Games draw the hidden thing's
silhouette through. The mock-up does not.

### 3. Lift: the three-quarter view

- **Each kind has a height**: a station 16 px, a belt 8, an arm 12, a teleporter 4, a zone 0. These are the
  mock-up's values at 32 px a tile.
- **The top face is drawn that much higher**, and the front face fills the gap. Shadow and feet stay on the tiles.
- **What rides on something takes its height**: a ticket on a belt is lifted by 8, in a station by 16.
- **A click hits what is seen**: the top and the front face, nearest first. `pick()` tests these boxes instead of
  the tiles.
- **Drops stay on tiles**: a ticket let go, a machine placed, a ghost in build mode.
- **The height is kept under half a tile**, so that the row above stays readable.

### 4. Pixel rendering

- **Paint at half resolution, enlarge without smoothing**: that is what gives pixel art from the same painters. The
  mock-up does it with one offscreen canvas.
- **Words are not painted at half resolution** (they become unreadable). They wait, and are written crisp over the
  enlarged picture in a pixel font at its own sizes (Silkscreen at 8 and 16, Pixelify Sans for names). Already done
  in the mock-up.
- **Zoom**: pixels stay sharp only at whole multiples. Either the pixel skin's zoom moves by steps, or the offscreen
  is drawn at the nearest multiple and the rest is accepted. To decide on a real floor.
- **Sprites**: the mock-up draws everything with code. The charm of the screenshot that started this came from
  sprites drawn by hand: workers, the robot, the decor. Who draws them is an open question (code, an artist,
  generated).

### 5. The decor on a floor that changes and zooms

The floor is not a fixed picture. It grows as machines are built (`floorRect` in `renderer.ts`: what is built plus a
margin of `FLOOR_MARGIN = 8` tiles each side, never smaller than 300 by 150), and the view zooms from far to near and
cannot leave it. The decor has to follow without being placed by hand.

- **The decor is generated, not placed.** It is computed from the floor's rectangle and from which tiles are free,
  with a seed per tile so it does not change from one frame or one visit to the next. Adding a column of machines
  adds wall and windows; removing one removes them.
- **The wall** runs along the top edge of the floor's rectangle, in its margin, a few tiles high. Windows, pipes,
  doors, clock and signs repeat along it at fixed steps from its left end, chosen by the seed. When the floor grows
  upwards, the wall moves up with it: it is never on a built tile, by construction.
- **Props** (plants, crates, desks, extinguishers) are scattered on free margin tiles, with a clearance of one tile
  round machines and lines, so a prop never hides something and never takes a click.
- **Zoom**: the decor is drawn in tile units like the floor, so it zooms with it. Far out, it simplifies (windows
  become bands, small props go), as the floor's dots already fade.
- **Cost**: what does not move (floor, wall, platforms, rails, props) is painted once into a cached picture, as the
  floor's backdrop is today (`floor()` in `renderer.ts`), and painted again only when the layout, the zoom step or
  the size changes.
- **It can be turned off**, as the mock-up's "Décor" button does.
- **Later, maybe**: decor placed by hand in build mode (Build › Decor). Generated first; hand-placed only if
  generation is not enough.

### 6. People

People are cosmetic: they carry no ticket, take no tile and answer no click. They say what the floor is doing.

- **At a station**: one worker at its foot, still when the station waits, busy when it runs. Already in the
  mock-up.
- **In the aisles**: walkers going along the free tiles between lines. The walkable map is the free tiles of the
  floor (no machine, not inside a line's platform), computed when the layout changes. A walker picks a far point and
  follows a path on it, with a simple search on the grid.
- **Telling something**: when a gate waits for a decision, someone walks to its desk and waits there. When a run
  fails, a worker raises a hand. These are worth a mock-up of their own.
- **Limits**: a cap on how many walk at once, none below a zoom level, none for whoever asks for less motion
  (`prefers-reduced-motion`), and a budget of time per frame.

### 7. Lines (platforms and guard rails)

A line is a part of the floor named as a place: "Build line", "Rework line".

- **It is a new element of the layout**, kind `line`: a rectangle in tiles, a name, a colour, and its style
  (platform, rails). The engine ignores it, as it ignores labels. Labels are already exempt from the overlap check
  (`normaliseLayout` in `packages/server/src/factory/engine.ts`, the `m.kind !== 'label'` before the `taken` set),
  so a line can be too: machines stand on it.
- **It is drawn in build mode with the mouse**: Build › Area › Line, then drag a rectangle as the selection frame
  does. Once placed it has handles to resize it, and a popup for its name, colour and style. It moves with what
  stands on it, or alone: to decide.
- **A platform** is the line's floor raised by a few pixels, in its colour, with its front edge seen from three
  quarters. Either it raises what stands on it (platform height plus each machine's own lift), or it is only a
  coloured edge under them: to decide. The first looks right; the second is simpler.
- **Guard rails** run along the line's edges and open by themselves where a belt, a bridge or an arm crosses an edge,
  and where a teleporter or an exit sits on it. Nothing to set by hand. Where two lines touch, the shared edge has no
  rail.
- **The aisle** is the floor between lines. It is not drawn: it is what is left, and it is where people walk.
- **What a line could mean later**: its own figures (shipped, lead time, cost), a limit of tickets in work, its name
  on the minimap, the tickets that wait for someone grouped by line. This is where incarnation becomes useful and
  not only pretty.

## What the code says (verified, paths from `packages/`)

- `web/src/factory/renderer.ts`:
  - `FactoryView`, 1 618 lines; draws by kind of element in a fixed order (`draw()`), not by depth.
  - `floor()` caches the floor's backdrop in an offscreen canvas keyed on size, camera, layout and palette. This is
    the pattern for static layers.
  - `floorRect()` and `FLOOR_MARGIN = 8` give the floor's rectangle; `constrain()` keeps the view on it.
  - `pick()` answers clicks from geometry, not from paint.
- **Geometry already apart**: `web/src/factory/machineArt.ts` (a station's parts, places, lamp), `quays.ts`,
  `bridges.ts`, `teleport.ts`, `armMotion.ts`, `ticketMotion.ts`.
- **Tickets** are drawn from the icon of their type (`web/src/factory/ticketToken.ts` reads `TicketTypeIconSvg`).
- **Light themes**: `legible()` and `contrast()` in `web/src/factory/floorLook.ts`; `floorLook.test.ts` holds every
  hue of the floor to 4.5 on a light body. The same test should hold for each skin: all its inks against all its
  grounds.
- **The console's shape** is in `web/src/factory/hudShape.ts`, its shadow in `FactoryHudShadow.tsx`, the build tape
  in `FactoryBuildFrame.tsx` (`tapeShape()` follows the console's contour).
- **The layout** is a JSON document with a version (`server/src/factory/layout-versions.ts`, `LAYOUT_VERSION = 2`).
  - Adding a kind that old floors simply do not have needs no conversion: no version step, or one that returns the
    layout as it is.
  - A change of geometry would archive every floor. Nothing here changes geometry.
- **The engine** must learn to accept kind `line` (`normaliseLayout`) and to ignore it everywhere, as it does
  `label`. That is the only server change.

## Open questions

1. **Skin and theme**: does a skin recolour the console, or does the console keep the app's theme? The pixel skin has
   a cream floor; the app may be dark.
2. **Who chooses the skin**: a setting of the floor (everyone sees the same factory) or a preference of each person?
3. **Pixel zoom**: zoom by whole steps in the pixel skin, or accept soft pixels between them?
4. **Sprites**: drawn by code, by an artist, or generated? And by whom, in what tool?
5. **Platforms**: do they raise what stands on them?
6. **Lines**: can a machine straddle a line's edge? Can lines overlap or nest? Does moving a line move what stands
   on it?
7. **Hidden tickets**: a silhouette drawn through what hides them, or a fade of the front face when pointed at?
8. **People**: which events deserve a person (a gate waiting, a failure, a ticket shipped)? How many is too many?
9. **Build mode in three quarters**: ghosts stay on tiles; is the build tape enough, or does build mode go flat?
10. **Order against the intake PR** (`docs/factory/intake-handover.md`): which comes first? They touch different
    things (items in the engine against paint in the page), but both touch the renderer's ticket drawing.

## Where it stands

- **Lot 0, done**: `packages/web/src/factory/shots/` and `packages/web/scripts/factory-shots/run.mjs` paint a made-up
  floor with one of everything in eleven situations and compare two runs pixel by pixel. It is the check for every lot
  below that should change nothing that shows.
- **Lot 1, done**: `scene.ts` says what is shown and where, and owns everything that lives from one frame to the next
  (easing, belts, cups, quays, exits, jumps). `renderer.ts` only paints the scene. Checked: the eleven pictures are
  identical to the pixel to those of `main`.
- **Lots 2 and 3, done together**: `skins/skin.ts` is the contract (`Skin`: `ground`, `pieces`, `top`, `minimap`; a
  `Surface` to paint on; `Piece` with a layer, a depth and what carries it; `order`, tested). `skins/fleex.ts` is
  today's drawing, colours and light-theme rules included, as a flat skin: one layer, its depth the old paint order.
  `renderer.ts` is only the view (camera, pick, the frame loop). Same check, identical pictures.
- **Lot 4, done**: picked on `docs/factory/skin-choice.html` (a soft glow, the belts' chevrons in the theme's accent,
  the choice made on cards with a preview). `factorySkin` in the settings, chosen in Settings › Appearance under the
  theme (`FactorySkinPicker.tsx`, previews painted live from `shots/fixture.ts`). The neon skin (`skins/neon.ts`):
  a palette and one glow over the whole picture. The page around the floor takes the skin's colours through the CSS
  variables of a night theme (`nightTheme` + `themeVars`, set on the page's element), the minimap too; popups keep the
  theme. `neon.test.ts`: every ink on every ground, for every built-in theme. Fleex's pictures still identical.
- **Lot 5, done**: picked on `docs/factory/pixel-flat.html` (a live mock-up embedding the real renderer: a workshop at
  night on a dark theme, pixel fonts). `skins/pixel.ts`: painted at 16 art pixels a tile and enlarged without
  smoothing, the words crisp after; tiles, flat outlined bodies, hard shadows, a lamp light in rings that flicker
  (asked for after a first dithered try read as dotted outlines), crates, and a
  procedural worker at each station that runs something. The zoom by steps is the view's (`steps` on `Skin`,
  `FactoryView.wheel` / `glide`): it glides and only rests on a step. Fonts served by Fleex (`public/fonts`, OFL).
  The page in the workshop's colours (`workshopTheme`); `pixel.test.ts`; two pixel pictures among the checks.
  Not done: an exit's light is still a soft glow under the pixel skin.
- **Lot 6, done**: picked on `docs/factory/pixel-3q.html` (live): a skin of its own, **Pixel 3D** (`skins/pixelTq.ts`),
  platforms raise what stands wholly on them (E1), a hidden ticket's outline is drawn through what hides it (C2), build
  mode goes flat (B2). A skin says how high it paints each machine (`liftOf`); the view's pick, frame, ticket card and
  names follow what is seen. Two Pixel 3D pictures among the checks. Open questions 5, 7 and 9 are answered.
- **Readability, done (before lot 8)**: the owner asked for pixel art that reads ("lisibilité first") and picked R2,
  both steps. `PixelLook` in `skins/pixel.ts`, both on by default (`PIXEL_LOOK`) for Pixel and Pixel 3D: `crisp` (step 1: the view on the grid of art
  pixels, words in Silkscreen at whole multiples of 8 screen pixels, each ticket the 11-pixel object of its type, no
  line under a pixel) and `sprites` (step 2: every part of the floor drawn pixel by pixel with `skins/pixelArt.ts`, a
  pixel full when its middle is in the shape: stations and their traffic-light lamp, belts and bends, bridges,
  gantries, arms and tolls, quays, zones with their padlock and stencilled stock, exits as a frame of light, teleporters
  and their links, status stations, areas, the lens, the tickets' marks, the overlay; plates with cut corners).
  Mock-ups: `pixel-crisp.html` (today / step 1 / steps 1 and 2), `pixel-tickets.html` (every type),
  `pixel-parts.html` (every part, Fleex and pixel side by side). Fleex's and neon's pictures unchanged; the lamp's
  light is brighter on the day workshop; the four pixel check pictures now show both steps.
- **Next, lot 8 before lot 7**: the owner described the platforms as a feature of build mode (below). A mock-up first.

### Lot 8 as the owner described it (decided)

The platforms are a feature of their own, drawn in build mode:

- **Independent of the machines.** An area of the floor is laid where one wants; nothing in the data links it to the
  stations on it. Whether a machine is raised is worked out when painting, from where it stands (wholly on it).
- **Drawn with the mouse.** Click and drag makes a rectangle of X by Y tiles. Areas are always rectangles, on the
  tiles.
- **Its settings:** a name, a colour, where the name is written.
- **Changed in build mode only.** A placed area is resized by dragging its sides (width, height) or its corners. It
  can be edited and removed there.
- **Out of build mode it is decor:** nothing of it answers a click.
- **How skins show it:** a raised platform under Pixel 3D; the other skins need a look of their own (to mock up).
- **Its name in the product: Area.** "zone" is taken (a machine where tickets wait: Inbound, Ready). The build
  sub-menu that was called Area (zone, exit, label) is renamed **Place**, and Area is placed from it.
- **In the flat skins** (Fleex, Neon, Pixel): a tinted slab bordered in its colour, its name on the floor.
- **Moved by its name** (D1, picked on `docs/factory/areas.html`): a drag on the floor stays the frame that selects
  machines. **Areas nest, never cross** (O2): one may lie wholly inside another, never across its edge; the smallest is
  on top and is the one selected.

## Proposed order of work

Each step is a lot, with a mock-up first when it shows or asks something.

1. **The scene**: a module that says what to show, without painting. `renderer.ts` reads it. No visible change,
   checked by comparing captures before and after.
2. **The skin "Fleex"**: today's drawing behind a `Skin` interface. The 47 colours and the light-theme rules move
   into it. No visible change, same check.
3. **Layers**: the drawing loop sorts pieces by layer and depth, and carried things follow their carrier. Still no
   visible change on the flat skin.
4. **Choosing a skin**, plus the console's CSS variables and font per skin. The neon skin, as the first new skin:
   it proves the interface at little cost.
5. **The pixel skin, flat**: half resolution, crisp words, a first set of sprites.
6. **The three-quarter view**: a lift per kind, front faces and feet, `pick()` on seen boxes.
7. **The decor**: wall and props generated from the floor, cached, simplified when far.
8. **Lines**: kind `line` in the layout and the engine, Build › Area › Line drawn with the mouse, its popup,
   platforms and guard rails.
9. **People**: workers at stations, walkers in the aisles, then the people who tell something.

Lots 1 to 3 are the real work. Without them every skin is a copy of the renderer to keep up twice, and the three-
quarter view means cutting forty drawing methods one by one.

## To start the next session

Paste this:

> Read `docs/factory/skins-handover.md`, then open `docs/factory/skins.html` and `docs/factory/pixel-3d.html` and
> read their code, then `packages/server/src/factory/README.md`. We are starting the PR that makes the Factory
> skinnable, with the pixel skin, its three-quarter view, its decor, and lines drawn as platforms with guard rails.
> Start with step 1 of "Proposed order of work" and tell me first what you would change in that plan, and which of
> the open questions you need me to answer before lot 4.
