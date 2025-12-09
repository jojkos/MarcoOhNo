# Marco Oh No! - System Reference & Mechanics

## 1. System Overview
"Marco Oh No!" is a **local multiplayer tag game** designed for a "couch party" setting. 
- **The TV (Host)** acts as the central game board and spectator view.
- **Mobile Phones (Clients)** act as individual controllers and private screens for each player.

The game is built on a **Client-Server architecture**:
- **Server**: Authoritative game state, collision detection, and maze generation.
- **Client**: Phaser 3 rendering engine for high-performance 2D graphics and lighting effects.

---

## 2. Game Mechanics

### Roles
*   **The Seeker (1 Player)**
    *   **Goal**: Catch all Runners before time runs out.
    *   **Ability**: Has a flashlight (Vision Cone) that reveals runners.
    *   **Special**: "Marco" ability to reveal a random runner.
*   **The Runners (Many Players)**
    *   **Goal**: Survive until the timer reaches zero.
    *   **Ability**: Can see a small radius around themselves. Hidden by fog otherwise.

### The Maze
*   **Generation Logic**: The server generates a unique maze for every round using a **Recursive Backtracker** algorithm.
*   **Braiding**: The algorithm includes a "braiding" step that removes 10% of dead ends, creating loops. This ensures players don't get stuck in single-path corridors, allowing for juking and flanking.
*   **Walls**: Walls are physical obstacles that block both **Movement** (physics collision) and **Vision** (raycasting shadows).
*   **Smooth Movement**: Mobile clients implement client-side prediction and interpolation for responsive control.

### Catching Logic
A Runner is "Caught" when they are:
1.  **Visible**: Within the Seeker's **Vision Cone** (60° arc) AND within **Distance** (180px).
2.  **Line of Sight**: There are no walls between the Seeker and the Runner.
3.  **Exposure Time**: The runner must be exposed for a defined duration (cumulative). The "Catch Progress" bar fills up when visible and decays when hidden.
    *   *Result*: If the bar fills, the Runner dies, turns into a "RIP" marker, and their screen turns red.

### "Marco" Ability
*   **Trigger**: The Seeker presses the "Marco" button (15s cooldown).
*   **Effect**: The Server selects one random *alive* Runner.
*   **Visuals**:
    *   A massive, pulsing **Purple Ring** expands at that Runner's exact location.
    *   The text **"OH NO!"** floats up from their character.
    *   **Visibility**: This effect is rendered at **Depth 2000** (above the Fog of War, which is Depth 1000). It pierces through the darkness, allowing the Seeker (and TV spectators) to instantly locate the victim.

---

## 3. Visual Systems

### Fog of War (FoW)
The game relies heavily on atmospheric tension created by limited information. The FoW is implemented using two different techniques depending on the view:

#### TV View Implementation (Erasure)
*   **The Fog Layer**: A full-screen black rectangle (`Color: #050810`, `Alpha: 0.85`) covers the map at **Depth 1000**.
*   **The Reveal**: Uses `BlendMode.ERASE` to cut holes in the fog texture directly.
*   **Persistent Trail**: As the Seeker moves, their explored path is permanently "erased" from the fog.

#### Mobile View Implementation (Inverted Mask)
*   **The Fog Layer**: A full-screen black rectangle (`Color: #000000`, `Alpha: 1.0`) covers the map at **Depth 1000**.
*   **The Reveal**: Uses a Phaser **Geometry Mask** with `invertAlpha = true`.
*   **Logic**:
    *   A separate, invisible `maskGraphics` object draws shapes in white (vision cones, local circles).
    *   The mask makes the black fog *transparent* wherever `maskGraphics` has content.
    *   This provides a crisp, performant way to show only the local player's vicinity.

### Visibility Rules
*   **Seeker**:
    *   Projects a yellow **Vision Cone** (flashlight) calculated via raycasting (does not pass through walls).
    *   TV View shows this cone cutting through the darkness.
*   **Runners**:
    *   Have a simple 360° **Personal Light** with a small radius (120px).
    *   Cannot see through walls (though the simple circle radius might clip through walls visually, the game logic prevents seeing players behind them).

---

## 4. Views & Screens

### 📺 TV View (The Spectator)
The TV is the "God View" intended for the audience and the Seeker reference.
*   **Camera**: Fixed, showing the entire Map.
*   **Fog Behavior**:
    *   Starts mostly black.
    *   **Persistent Trail**: Stores `exploredAreas` (radius circles) on the server. The TV reveals where the Seeker has *been*.
    *   **Current Vision**: Shows the Seeker's current flashlight live.
    *   **Hiding Runners**: Runners outside the Seeker's explored areas are strictly hidden (covered by the black fog layer). "Marco" reveals pierce this fog.

### 📱 Mobile View (The Controller)
Personalized view for each player.
*   **Camera**: Smoothly follows the player (`startFollow` with lerp).
*   **Controls**: On-screen Joystick (D-Pad fallback).
*   **Fog Behavior**:
    *   **Local Vision Only**: Players only see their immediate surroundings.
    *   **No Memory**: The map goes dark again when you leave an area. This is critical for the "maze" feeling.
*   **Feedback**:
    *   Screen shakes when caught.
    *   "Progress Bar" appears above head when being hunted by Seeker.

---

## 5. Technical Architecture

### Server (`server/`)
*   **`routes.ts`**: The brain. Runs the game loop at **30 ticks/second**.
    *   Updates physics positions.
    *   Calculates "Catch Progress" for every runner-seeker pair.
    *   Manages timers and Game Phase state.
*   **`maze.ts`**: Standalone module for generating the `Wall[]` data structure via Recursive Backtracker.

### Client (`client/`)
*   **`PhaserGame.tsx`**: TV View rendering component (Erasure-style Fog).
*   **`MobileGameView.tsx`**: Mobile View rendering component (Mask-style Fog).
*   **`WelcomeScreen.tsx`**: Main entry screen using the "Marco Oh No" Logo.

### Shared (`shared/`)
*   **`physics.ts`**: Shared collision math.
*   **`schema.ts`**: Shared types and Zod schemas.

---

## 6. Configuration & Tweaking

Core constants are located in `shared/schema.ts` and `shared/assets.ts`:

*   **`MAP_CONFIG`** (`shared/schema.ts`):
    *   `seekerVisionDistance`: How far the flashlight goes (default: 180).
    *   `seekerVisionAngle`: Width of the cone (default: 60 degrees).
    *   `catchDuration`: Time to catch a runner (default: 2000ms).
    *   `gameDuration`: Round time (default: 60s).
    *   `playerRadius`: Size of player hitbox (default: 16).

