# Rooms, furniture, decor, daylight and 3D sound

Interiors (a kitchen, a café, a bedroom) built on `raea/room` and `raea/daylight`. Everything is placed
from the room's size and the models' own measured boxes: no typed coordinates except where along a wall a run starts.

## What to do

- The room: `const ROOM = defineRoom({ width, depth, height })`. Its walls are `back` (z = 0), `right` (x = width),
  `front` (z = depth) and `left` (x = 0), each a frame you can measure along: `onWall(ROOM.walls.right, u, v, y)` is a
  point `u` along the wall, `v` into the room and `y` up. Draw it with `<Room room={ROOM} openings={[...]} />`
  (`ceiling={false}` for a plan view from above).
- Units against a wall: `layRun(ROOM, "back", from, [{ src, name, children, front, width, role }])` lays each unit
  against the wall and against the one before, from its own box. Draw it with `<Run run={...} />`. A unit's `children`
  (doors, drawers) are placed in the unit's own frame. `role: "sink" | "stove" | "fridge"` feeds the work-triangle check.
- Windows and doors are `Opening`s on a wall. A bay window is `bay(ROOM, "front", at, { width, depth, angle, sill, head,
  seat })`, which returns the opening and a `seat` footprint for the window seat.
- Seats: never guess which way a chair faces. `faceToward(src, at, target)` gives the yaw that turns a chair, stool or
  bench (its front read from the model: the seat, then which side its back stands on) toward a table or island:
  `<Model src={CHAIR} position={at} rotation={[0, faceToward(CHAIR, at, TABLE_AT), 0]} />`. Backless stools have no
  front (`seatFacing` returns null); any yaw works.
- Check the layout before rendering: `checkLayout({ room, runs, islands, seats, furniture })` returns findings for the
  work aisle (1.07 m), walkways (0.91 m), room behind seats, the work triangle, overlaps and seats that don't face a
  table. Run it with `raea run check.ts` and fix every error.
- Wall decor: `hang(ROOM, "left", [{ src, name }], { at, centre, over, apart })` hangs pictures and shelves by the
  decorator's rules (`HANGING`). A piece hangs centred 1.5 m up on a bare wall; over furniture it hangs 0.18-0.30 m above
  it (`over: overUnits(run, "base-2")`) and centred on it; a group hangs a hand apart on one centre line. Each piece is
  turned by its own measured front. Draw it with `<Hang room={ROOM} hung={...} />`, and check it with
  `checkDecor(ROOM, hung, { openings, runs })`, which flags decor crossing windows, wall cabinets or tall units.
- Outside the windows: `plant(ROOM, [{ src, count, from, to, spacing, scale }], seed, avoid)` scatters trees, shrubs,
  grass and flowers in bands of distance from the walls, from a seeded stream. It is the same every frame, render and
  play. `<Outside plants={...} centre={[w / 2, d / 2]} />` draws the ground and the plants swaying with the clock.
- Daylight: `const DAY = daylight({ sky: staticFile("sky.hdr"), lat, lon, time: "2026-10-21T09:30:00+01:00", north })`
  puts the sun where it stands at that place and time, turns the sky panorama to match it, and reads the sky's light.
  Then add:
  - `<Daylight day={DAY} />` for the sun and the light bounced inside;
  - `<WindowLight day={DAY} room={ROOM} opening={o} />` for each window;
  - `<ToneMapping mode="agx" exposure={roomExposure(DAY)} />` for exposure, as a light meter would set it.
  Don't add your own sun or fill on top.
- A backsplash: `backsplash(ROOM, [BACK, RIGHT], { counter: 1.0, over: [BACK_UP, RIGHT_UP], openings, caps, height })`
  works out the tile's stretches from the runs: over every counter unit, on each wall it stands against (a corner unit's
  two), from the stone's back lip up to the wall cabinets, a hood (`caps: [{ wall, u0, u1, bottom }]`) or `height` over
  the stone, and under a window up to its sill. Tall units (a pantry, a fridge's housing) break it. Draw it with
  `<Backsplash room={ROOM} pieces={...} src={tiles} normalMap={...} tile={0.6} />`: slabs with the picture repeating at
  its real size (`tile`, metres per repeat of a seamless picture). Use slabs, not a decal, for tile that runs: a decal
  stretches its picture over its size.
- Decals on room surfaces: `<Decal src {...onSurface(ROOM, "right", u, y)} size={[w, h]} />` (`materials.md`, Decals).
- Sound in the room: `<Sound3D src={staticFile("kettle.wav")} at={[x, y, z]} loop />` (`raea/seedling`). It is
  heard from the scene's camera: panned, quieter and duller with distance, pitched by doppler when it moves. This works
  in renders and in games.

## Common mistakes

- Typing a chair's yaw by eye (`rotation={[0, Math.PI, 0]}`): half the pack's seats face -z and half face +z. Use
  `faceToward`.
- A chair overlapping its table: `checkLayout`'s overlap and "behind a seat" rules catch it. Move the chair out to
  the table's edge plus about 0.12 m.
- A shelf hung over a counter running into the tall unit beside it: `checkDecor` catches it.
- Scattering plants with `Math.random()`: they jump every frame. Use `plant` (seeded) or `seeded(n)`.
- Lighting a room with an Environment's light *and* a fill: the Environment from `daylight` is background only. Its
  light comes in through `Daylight` and the `WindowLight`s.
