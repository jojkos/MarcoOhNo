# Marco Oh No!

Hide-and-seek party game for 3–8 people in one room. The TV shows the seeker's flashlight, and
everyone's phone is their controller.

- **Runners** scatter while the lights are on. When it goes dark, they grab glowing orbs as a team and free caged friends.
- **The seeker** catches runners by keeping them in the flashlight, and can shout **POLO!** to make every runner give away roughly where they are.
- Caught once and you're **caged** until a teammate rescues you. Caught twice and you're a **ghost** who can BOO to confuse the seeker.

## Play
```
npm install
npm run dev
```
1. Open `http://localhost:5000` on the TV or laptop and choose **Host a game**.
2. Players scan the QR code on their phones (or open the shown address and type the room code). If someone drops out or reloads, they rejoin from the home screen.
3. Press **START**. The seeker role rotates every round.

Want to try it alone? `npm run bots -- ROOMCODE 3` fills the room with bots. On a desktop browser
you can also move with WASD, use the primary ability with Space and the secondary with Shift.

See [SYSTEM.md](SYSTEM.md) for rules, architecture and tuning (`shared/config.ts`).
