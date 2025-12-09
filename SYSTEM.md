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
    *   **Visibility**: This effect is rendered at **Depth 2000** (above the Fog of War). It pierces through the darkness, allowing the Seeker (and TV spectators) to instantly locate the victim, even if they are currently mapped in the fog.

---

## 3. Visual Systems

### Fog of War (FoW)
The game relies heavily on atmospheric tension created by limited information. The FoW is implemented using Phaser's **Geometry Masking**.

*   **The Fog Layer**: A full-screen black rectangle (`Color: #050810`, `Alpha: 0.9`) covers the entire map at **Depth 1000**.
*   **The Reveal (Masking)**:
    *   We do not "paint" light; we "erase" darkness.
    *   The `fogGraphics` layer uses `BlendMode.ERASE` to cut holes where players can see.
    *   This ensures that "darkness" is the default state, and unknown areas remain genuinely hidden.

### Visibility Rules
*   **Seeker**:
    *   Project a yellow **Vision Cone** (flashlight).
    *   Walls cast dynamic shadows (implemented via raycasting polygons).
*   **Runners**:
    *   Have a simple 360° **Personal Light** with a small radius (120px).
    *   Cannot see through walls.

---

## 4. Views & Screens

### 📺 TV View (The Spectator)
The TV is the "God View" intended for the audience and the Seeker reference.
*   **Camera**: Fixed, showing the entire Map.
*   **Fog Behavior**:
    *   Starts mostly black.
    *   **Persistent Trail**: As the Seeker moves, their path is permanently "etched" into the map (server stores `exploredAreas`). The TV shows where the Seeker has *been*.
    *   **Real-time**: Shows the Seeker's current flashlight cone live.
    *   **Note**: Runners outside the Seeker's explored path are **Hidden** from the TV view (unless they are caught or "Marco'd"). This prevents the TV from ghosting/cheating for the Seeker.

### 📱 Mobile View (The Controller)
Personalized view for each player.
*   **Camera**: Locked to the specific player's coordinates.
*   **Controls**: on-screen D-Pad / Joystick.
*   **Fog Behavior**:
    *   **Local Vision Only**: Players only see what is immediately around them.
    *   **No Memory**: Unlike RTS games, the Mobile view typically does not retain a "visited" map (or retains only a limited trail). If you walk away, the area goes dark again. This creates disorientation logic essential for the maze gameplay.
*   **Feedback**:
    *   Screen shakes when caught.
    *   "Progress Bar" appears above head when being hunted by Seeker.

---

## 5. Technical Architecture

### Server (`server/`)
*   **`routes.ts`**: The brain. Runs the game loop at **30 ticks/second**.
    *   Updates physics positions.
    *   Calculates "Catch Progress" for every runner-seeker pair.
    *   Manages timers and Game Phase state (Lobby -> Role Reveal -> Playing -> Game Over).
*   **`maze.ts`**: Standalone module for generating the `Wall[]` data structure.

### Client (`client/`)
*   **`PhaserGame.tsx`**: Unified rendering component.
    *   Accepts `isTVView` prop to toggle behavior.
    *   **Reconciliation**: Uses "Optimistic UI" for local player movement (instant feedback) but interpolates remote players based on server updates (smooth lag compensation).
*   **`GameHUD.tsx`**: React overlay for non-canvas UI (Timer, Lobby Codes, Winner screens).

### Shared (`shared/`)
*   **`physics.ts`**: Shared collision math (`rectIntersectsRect`, `lineIntersectsRect`).
    *   Used by **Server** to validate moves (prevent cheating/wall clipping).
    *   Used by **Client** to predict wall slides.

---

## 6. Configuration & Tweaking

Core constants are located in `shared/schema.ts` and `shared/assets.ts` for quick balancing:

*   **`MAP_CONFIG`** (`shared/schema.ts`):
    *   `seekerVisionDistance`: How far the flashlight goes (default: 180).
    *   `seekerVisionAngle`: Width of the cone (default: 60 degrees).
    *   `catchDuration`: Time to catch a runner (default: 2000ms).
    *   `gameDuration`: Round time (default: 60s).
*   **`ASSET_CONFIG`** (`shared/assets.ts`):
    *   Central place for file paths (images/sounds) and color palettes.
