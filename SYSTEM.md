# Marco Oh No! – System Reference

A couch-party hide-and-seek game. One screen everyone can see (the **TV**) shows the seeker's
flashlight view; every player uses their **phone** as controller and private screen.

## Game rules

**Roles.** Each round, one player is the **Seeker** and everyone else is a **Runner**. The seeker
rotates so everyone gets a turn, and points carry across rounds.

**Round phases** (`shared/protocol.ts` → `Phase`):

| Phase | Length | What happens |
|---|---|---|
| `reveal` | 3.5 s | TV announces the seeker; phones show your role. Nobody moves. |
| `scatter` | 10 s | Runners see the whole maze lit and run to hide. The seeker is frozen and blind (TV is black). |
| `hunt` | 150 s | Lights out. The TV shows only the seeker's flashlight. |
| `round_over` | – | Results and scores. Host/VIP starts the next round or returns to the lobby. |

**Win conditions.**
- **Runners win** by collecting `orbsToWin` orbs as a team (`2 + 2 × runners`). A few orbs are on the map at a time; new ones appear as they're picked up.
- **Seeker wins** if, at any moment, no runner is free (all caged or ghosts), **or** when the timer runs out. Hiding in a corner doesn't win; runners must play the objective.

**Catching.** A runner inside the seeker's cone (70°, 250 px) or close aura (55 px), with line of
sight, fills an exposure meter (1.6 s to fill, drains quickly when out of light).
- 1st catch → **caged** at that spot. A free teammate standing next to the cage for ~2.2 s frees
  them, with 3 s of invulnerability. Cages are visible to everyone, so the seeker can camp them.
- 2nd catch → **ghost**. Ghosts float through walls, can't be caught or collect orbs, and can **BOO**.

**Abilities** (cooldowns in `shared/config.ts` → `ABILITIES`):
- Seeker: **POLO**: every free runner shows a ring near (not exactly at) their position. **SPRINT**: a short speed boost.
- Runner: **DASH**: a short burst.
- Ghost: **BOO**: a fake noise on the seeker's view. During a POLO it looks exactly like a real POLO ring.

**Noise.** Picking up an orb, BOO, and standing still for 10 s ("sneeze") each make a ring on the seeker's view.

**Scoring.** Seeker gets +1 per catch and +3 for a win. Runners get +1 per orb, +2 per rescue, and +3 each for a team win.

## Architecture

```
shared/   config.ts    all tuning constants (speeds, vision, timers, scoring)
          protocol.ts  wire types (RoomInfo, Snapshot, FxEvent, InputMsg, events)
          physics.ts   deterministic movement + wall sliding (used by server AND client)
          geometry.ts  raycasts, line of sight, light polygons, seekerSees()
          maze.ts      maze generator (backtracker + braiding + plazas, merged walls)
          rules.ts     ability mapping, frozen rules, movement context
server/   routes.ts    socket.io wiring, room registry, 30 Hz loop, /api/lan
          game/room.ts the authoritative game: lobby, rounds, input queue, catching, orbs…
client/   pages/       Home, Join, TvPage/PlayPage (routing with wouter)
          lib/net.ts   socket wiring, URL-driven room attachment, snapshot buffer, actions
          lib/storage.ts  seats, host tokens, recent rooms
          components/kit.tsx  design system (backdrop, logo, glass panels, neon buttons)
          game/GameScene.ts  Phaser scene for both TV and phone views
          game/predictor.ts  client-side prediction + reconciliation
          game/input.ts      joystick/keyboard state
          components/game/*  React screens (lobbies, HUDs, overlays, results)
script/bots.ts           headless bots for solo playtesting
tests/                   vitest: physics/maze/geometry, room rules, netcode
```

### Networking model
- **Server-authoritative.** Phones send `input` messages (`seq`, joystick vector, ability
  presses) at 30 Hz. The server applies each input as one fixed physics step. A per-player credit
  budget (1 per tick, burst 4) stops speed hacks and absorbs jitter.
- **Client prediction.** The phone applies its own inputs immediately with the same `stepMover`.
  Each snapshot carries `ack` (the last processed seq); the phone rewinds to the server state and
  replays the unacked inputs. Physics is deterministic, so corrections are near zero; any that remain fade out visually.
  `tests/netcode.test.ts` checks this against the real `Room` with simulated latency.
- **Interpolation.** Other players are drawn ~110 ms in the past, between two buffered snapshots.
- **Messages.** `room` (lobby state + maze, only when it changes), `snap` (positions etc., every
  tick, sent as volatile), `fx` (one-off events: polo, noise, caught, freed, orb).
- **Joining and reconnecting.** See "Screens, URLs and sessions" below.

### Screens, URLs and sessions
Every screen has its own URL, so browser back/forward, reload and bookmarks behave:

| URL | Screen |
|---|---|
| `/` | Home: host, join, and "pick up where you left off" cards for rooms this browser is still part of |
| `/join/CODE` | Join form (the TV's QR code points here). Offers "Rejoin as X" if this browser already has a seat |
| `/play/CODE` | A player's phone. Without a saved seat it redirects to `/join/CODE` |
| `/tv/CODE` | The shared screen. With the host token it controls the room, otherwise it only watches |

- The **URL decides** which room a tab follows (`client/src/lib/net.ts` → `attachTv` / `attachPlay`).
  Every socket reconnect re-attaches to it, so Wi-Fi drops and server hiccups recover by themselves.
- **Seats** (`client/src/lib/storage.ts`) are saved per tab (sessionStorage), with a per-browser copy
  (localStorage). Two tabs can be two different players, and closing and reopening the browser still rejoins.
  **Host tokens** are saved per browser.
- Leaving a room page (back button, Home) only *detaches*: the seat is kept and shows as reconnecting.
  "Leave room" gives the seat up for good.
- A player who lost their saved seat (other phone, private mode) can reclaim it by joining with the
  same name while that seat is disconnected.
- Opening the same seat or TV somewhere else moves it there. The old tab shows "Playing somewhere else"
  with a button to take it back.
- The server **never creates rooms implicitly**. If a room is gone (idle for 10 minutes, or the server
  restarted), screens say "Room has ended" and offer to start a new one.
- Grace periods: a player disconnected in the lobby is dropped after 20 s. A seeker gone for 25 s cancels the round.

**Hosting note:** rooms live in the server's memory. Deploy to a single always-on instance
(Replit: Reserved VM, or Autoscale with max instances = 1). Multiple instances, or scale-to-zero,
make players land on a server that doesn't know their room.

### Visibility
The server decides who is lit (`SnapPlayer.lit`) using the same `seekerSees()` the client uses for drawing.
- **TV / seeker phone:** fog with the cone + aura cut out. Walls the light touches are remembered in grey (map memory). Runners are drawn only when lit.
- **Runner phone:** a small light circle blocked by walls. The whole maze stays as a grey outline because they saw it during scatter. Others are visible only inside your light.
- **Ghost phone:** no fog.
- **Everyone:** orbs and cages are always visible.

## Running
```
npm install
npm run dev          # http://localhost:5000: host on the TV, phones join via QR / room code
npm run bots -- ABCD 3   # add 3 bots to room ABCD
npm test             # vitest
npm run check        # typecheck
npm run build && npm start
```
