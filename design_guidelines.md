# Shadow Run - Game Design Guidelines

## Design Approach
**Reference-Based Approach** drawing from asymmetric multiplayer games:
- Among Us: Clean lobby UI, color-coded players, clear status indicators
- Dead by Daylight: Dark atmospheric tension, clear HUD elements
- Jackbox Party Pack: Simple mobile controls, TV-optimized display, join code system

Key Principles: High contrast for visibility, atmospheric tension through dark palette with bright UI elements, instant readability at a distance (TV), touch-optimized mobile controls.

## Typography
- **Primary Font**: 'Rajdhani' or 'Orbitron' (Google Fonts) - geometric, modern, game-appropriate
- **Display/Headers**: 700 weight, uppercase for game states (LOBBY, SEEKER, RUNNER)
- **Body Text**: 500 weight for player names, instructions
- **UI Numbers**: 700 weight, large size for timer (72px TV, 48px mobile)
- **Join Codes**: Monospace numbers, 64px, letter-spaced

## Layout System
**Spacing Units**: Tailwind 2, 4, 8, 12, 16 for consistent rhythm
- Mobile: Compact spacing (p-4, gap-2)
- TV: Generous spacing (p-8, gap-4) for distance viewing

## Interface-Specific Layouts

### TV/Monitor View (16:9 landscape)
- **Lobby Screen**: Centered card (max-w-2xl) with room code display, player list grid (2-3 columns), prominent START button
- **Game Screen**: Full-bleed game canvas with HUD overlay
  - Top bar: Timer (center), caught players counter (right)
  - Bottom: Player status indicators (horizontal row)
  - Corner overlays: Marco cooldown indicator, mini-map option

### Mobile View (portrait)
- **Join Screen**: Full-height centered form, large input for room code, player name field
- **Lobby Wait**: Player list (single column), role display, ready indicator
- **Game Screen**: 
  - Canvas fills viewport minus controls
  - Bottom third: Virtual joystick (left) + Marco button (right)
  - Top: Personal stats bar (minimized)

## Component Library

### Navigation & Lobby
- **Room Code Display**: Large box with 4-digit code, copy button, monospace font
- **Player Cards**: Grid items with avatar icon, name, status dot (waiting/ready/caught/alive)
- **Join Input**: Numeric keypad-style or large text input with auto-focus

### Game HUD Elements
- **Timer**: Circular progress indicator with seconds remaining, pulsing at <10s
- **Status Indicators**: 
  - Seeker: Red cone icon with "flashlight" label
  - Runners: Green running icon with player name
  - Caught: Gray with RIP marker
- **Marco Button**: Large circular button (80px mobile) with cooldown overlay (radial progress)
- **RIP Markers**: Skull icon or crossed-out player avatar at catch location on map

### Game Canvas Overlays
- **Fog of War**: Semi-transparent dark overlay (#000000 at 85% opacity) with visibility cutouts
- **Vision Cone**: Gradient from center (transparent) to edges (fog opacity)
- **Player Avatars**: Simple geometric shapes or initials in colored circles (16px mobile, 24px TV)
- **Marco Reveal**: Pulsing ring animation around revealed player (2s duration)

### Controls (Mobile Only)
- **Virtual Joystick**: Translucent circular base (120px) with draggable knob (60px)
- **Action Button**: 72px circular button, bottom-right corner with clear icon/label

## Game States & Screens

1. **Welcome Screen**: Title, "Create Game" or "Join Game" buttons (full-width, stacked)
2. **Lobby**: 
   - TV: Large room code, player grid, start game button (disabled until 3+ players)
   - Mobile: Join form → waiting room with player list
3. **Role Assignment**: Brief full-screen announcement "YOU ARE THE SEEKER" or "RUN!" (2s)
4. **Active Game**: Canvas + HUD as described above
5. **Game Over**: 
   - Winner announcement (full-screen)
   - Player statistics (catches, time survived)
   - "Play Again" button

## Visual Hierarchy
- **Critical Info** (Timer, Role): Largest, highest contrast
- **Game Canvas**: Dominates viewport (70-80%)
- **Controls**: Always accessible, clearly separated from canvas
- **Secondary Info** (player count, cooldowns): Smaller, less prominent

## Responsive Breakpoints
- Mobile: 320px - 768px (portrait assumed)
- TV/Desktop: 1280px+ (landscape assumed)
- Tablet: Redirect to mobile or TV mode based on orientation

## Animations
**Minimal and Purposeful**:
- Marco reveal: 0.3s scale-up + pulse effect
- RIP marker: 0.5s fade-in with slight drop
- Fog of war reveal: Instant (performance critical)
- Player movement: Smooth interpolation (handled by Phaser)
- Timer warning: Pulse effect at <10 seconds
- Lobby join: Slide-in animation for new players (0.2s)

## Images
**No Hero Images** - Game interface only
- **Player Avatars**: Simple generated geometric patterns or color-coded circles with initials
- **Icons**: Heroicons for UI elements (play, pause, copy, etc.)
- **Game Assets**: Handled by Phaser.io canvas rendering

## Accessibility Notes
- High contrast maintained throughout (fog vs. visible areas)
- Large touch targets (minimum 48px)
- Clear visual feedback for all interactions
- Text remains readable on both TV (10ft viewing) and mobile (1ft viewing)
- Color is never the only indicator (use icons + text labels)