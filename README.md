# Marco Oh No!

A neon hide-and-seek party game for 2–8 people in one room (3+ is best). The TV shows the seeker's flashlight,
and everyone's phone is their controller.

- **Runners** scatter while the lights are on. When it goes dark, they charge glowing orbs as a team
  (stand on one until it pops), hide in lockers, use items and free caged friends.
- **The seeker** catches runners by keeping them in the flashlight, shouts **POLO!** to make every
  runner give away roughly where they are, searches lockers and throws flares or sets traps.
- Caught once and you're **caged** until a teammate frees you (or you slowly pick the lock). Caught
  twice and you're a **ghost** who floats through walls and can BOO to fool the seeker.

## Play
```
npm install
npm run dev
```
1. Open `http://localhost:5000` on the TV or laptop and choose **Host a game**.
2. Players scan the QR code on their phones (or open the address and type the room code). Reloading
   or losing Wi-Fi puts you back in your seat; the home screen also offers to rejoin.
3. Press **START**. The seeker rotates every round.

Not enough people? Add bots from the TV lobby (or from a phone if there is no TV). On a desktop
browser you can move with WASD/arrows: Space = primary ability, Shift = secondary, Q = item, E = hide/search.

See [SYSTEM.md](SYSTEM.md) for rules, architecture and tuning (`shared/config.ts`).

Needs Node 22+.
