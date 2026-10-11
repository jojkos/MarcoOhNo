# Marco Oh No! – System Reference

A couch-party hide-and-seek game. One screen everyone can see (the **TV**) shows the seeker's
flashlight view; every player uses their **phone** as controller and private screen.
All tuning lives in `shared/config.ts`.

## Game rules

**Roles.** Each round one player is the **Seeker**, everyone else is a **Runner**. The seeker
rotates (humans before bots) and points carry across rounds.

| Phase | Length | What happens |
|---|---|---|
| `reveal` | 4 s | TV announces the seeker; phones show your role. Nobody moves. |
| `scatter` | 10 s | The maze is lit for runners, who run off to hide. The seeker is frozen and the TV counts down. |
| `hunt` | 150 s | Lights out. The TV shows only what the seeker's light reveals. |
| `round_over` | – | Winner, awards and leaderboard. Host or VIP starts the next round or returns to the lobby. |

**Win conditions.**
- **Runners win** by charging `orbsToWin = 3 + 2 × runners` orbs. Standing on an orb charges it in
  2 s (faster with friends); stepping off drains the charge. A charging orb glows brighter, which the
  seeker can see. Only a few orbs are out at once and a new one appears 5 s after one is taken.
- **Seeker wins** the moment no runner is free (all caged or ghosts), or when the timer runs out.

**Catching.** A runner in the seeker's cone (72°, 260 px) or aura (56 px), in line of sight, fills an
exposure meter: 1.5 s with 4+ runners, a bit longer for small groups. It drains when out of light.
- 1st catch: **caged**. A free teammate next to the cage frees you in 2.2 s (then 3 s invulnerable).
  Alone you pick the lock in 30 s. Caged players have a **HELP** button that pings teammates.
- 2nd catch: **ghost**. Ghosts float through walls, can't be caught or charge orbs, and can **BOO**.

**Abilities** (`ABILITIES`): seeker **POLO** (rings near every free runner) and **SPRINT**;
runner **DASH**; ghost **BOO** (a fake noise, indistinguishable from a real POLO ring).

**Lockers.** Runners can hide in a locker for up to 12 s (then it creaks open). They're invisible
inside. The seeker can search a locker (0.9 s); finding someone catches them on the spot.

**Item boxes.** Three boxes on the map, respawning after 9 s. Runners get **smoke** (a cloud that
blocks light), **decoy** (a fake runner that pops when lit) or **flash** (blinds a nearby seeker for
2.5 s). Seekers get **flare** (lights an area for 6 s) or **trap** (roots a runner for 2.5 s, with a noise).

**Noise.** Banking an orb, BOO, traps, and standing still for 10 s ("sneeze") make a ring on the seeker's view.

**Scoring** (`SCORING`): seeker +1 per catch, +3 for a win; runners +1 per orb, +2 per rescue, +3
each for a team win. The results screen hands out awards (closest call, orb hoarder, hero, daredevil,
locker legend, exterminator, eagle eye).

**Balance.** `npx tsx script/sim.ts [rounds] [bots]` plays all-bot rounds headlessly and reports
win rates and hunt lengths. With the current numbers bots land around 40–70 % seeker wins depending
on group size, with hunts of about a minute (humans are slower than bots).

## Architecture

```
shared/    config.ts     tuning constants
           schema.ts     Colyseus state schema (GameState, Player, Round, Thing…)
           protocol.ts   join options, client/server messages, fx events, results
           physics.ts    movement + wall collision (used by phones and server validation)
           geometry.ts   raycasts, light polygons, line of sight, seekerSees()
           maze.ts       maze generator (backtracker + braiding + plazas), lockers, cell graph
           rules.ts      ability mapping, cooldowns, speeds, who is frozen
server/    index.ts      entry: API + Colyseus on one HTTP server, Vite in dev, static in prod
           app.ts        createApp(): express routes (/api/lan, /api/rooms/:code) + Colyseus
           rooms/PartyRoom.ts  Colyseus room: auth, seats, host/watch bindings, reconnection
           game/Game.ts  all game rules over the schema state, transport-free and unit-tested
           game/bots.ts  server-side bots (BFS over the cell graph); they play every role
client/    lib/session.ts   Colyseus client, URL-driven attach/reconnect, clock sync, actions
           lib/gameStore.ts zustand store with a throttled view of room state for React
           lib/storage.ts   seats, host tokens, recent rooms, name/face
           game/Renderer.ts PixiJS renderer for TV and phone views
           game/Lighting.ts light map: per-light visibility meshes into a blurred render texture
           game/MazeView.ts, Character.ts, Effects.ts, textures.ts  procedural art and effects
           game/LocalMover.ts  local player movement (client side) + server corrections
           game/Interp.ts      interpolation of other players against server time
           audio/        synthesized SFX bank, Tone.js adaptive music, haptics, settings
           components/   React UI: kit (design system), lobbies, HUDs, controls, results
           pages/        Home, Join, TV and Play pages (wouter routes)
script/    build.ts      production build (Vite client + esbuild server bundle)
           sim.ts        headless bot balance simulation
tests/     shared.test.ts  maze, physics, geometry
           game.test.ts    rules: flow, catching, cages, orbs, items, lockers, seats, bot matches
           server.test.ts  real Colyseus server over WebSockets: codes, joins, rejoin, eviction, sync
```

### Networking model
- **Colyseus state sync.** The server owns `GameState` and patches it to every client at 30 Hz.
  One-off events (POLO, noises, catches, orbs, item use…) go out as `fx` messages.
- **Movement is predicted on the phone.** `LocalMover` moves the player locally every frame with the
  shared physics and sends its position at 30 Hz. The server checks each move: speed (with slack and
  ability boosts), wall overlap, and wall crossing between updates. A rejected move snaps the
  server copy back and sends `correct`, which the phone eases toward. Abilities that change speed
  (dash, sprint) are predicted too, so there's no input lag on any network.
- **Interpolation.** Other players are drawn ~110 ms behind server time; the clock is synced with
  ping/pong (median offset).
- **Bots** run inside the server tick with the same rules and validation-free movement.

### Screens, URLs and sessions
| URL | Screen |
|---|---|
| `/` | Home: host, join, and "pick up where you left off" cards |
| `/join/CODE` | Join form (the TV's QR code points here), with name and face picker |
| `/play/CODE` | A player's phone. Without a saved seat it redirects to `/join/CODE` |
| `/tv/CODE` | The shared screen. With the host token it controls the room, otherwise it watches |

- The URL decides which room a tab is attached to. Colyseus reconnection (40 s window) handles
  network drops; after that the client re-joins with its seat token.
- Seats are saved per tab (sessionStorage) with a per-browser copy (localStorage). Host tokens are
  per browser. A player who lost their token can reclaim a disconnected seat by joining with the same name.
- Opening the same seat or TV somewhere else moves it there; the old tab says so and can take it back.
- Leaving a page only detaches (the seat shows as reconnecting). "Leave room" gives the seat up.
- Rooms are never created implicitly. A room idle for 10 minutes is disposed and screens say it ended.
- Grace periods: a player disconnected in the lobby is dropped after 20 s; a seeker gone for 30 s
  cancels the round.

### Rendering
PixiJS (WebGL). The world (floor, walls, lockers, characters, items) is drawn with procedurally
generated textures. A **light map** is rendered each frame: every light (seeker cone + aura, runner
light, orbs, flares, item boxes) is a triangle fan built from its visibility polygon, so walls cast
real shadows, textured with a radial falloff, blurred, and multiplied over the world. The same map
is added on top at low alpha so beams glow. Above the darkness: remembered wall outlines, orb and
item glows, cages, labels and effects.

Who sees what:
- **TV / seeker phone:** black except the seeker's light, orbs, flares and item boxes. Walls the light
  touches are remembered as outlines. Runners appear only when lit.
- **Runner phone:** a small light around you, plus the maze outline (you saw it during scatter).
- **Ghost phone:** dim but fully visible.

### Audio
- **SFX** are synthesized into AudioBuffers on first use (no audio files).
- **Music** is generated live with Tone.js, loaded on the first tap: a synthwave lobby loop, a
  tension bed for reveal/scatter, and a hunt track whose layers follow time and danger, faster
  in the last 30 s. The TV plays music by default; phones only if turned on.
- Runner phones add a heartbeat that speeds up as the seeker gets close, a rising whine while
  exposed, orb charging blips, and vibration on Android.

## Running
```
npm install
npm run dev              # http://localhost:5000 (PORT env overrides)
npm test                 # vitest: unit + real-server integration
npm run check            # typecheck
npx tsx script/sim.ts    # bot balance simulation
npm run build && npm start
```

**Hosting.** Rooms live in the server's memory, so run exactly one always-on instance (Replit:
Reserved VM, or Autoscale with max instances = 1; scale-to-zero ends rooms when idle).
WebSockets and HTTP share one port. Requires Node 22+.
