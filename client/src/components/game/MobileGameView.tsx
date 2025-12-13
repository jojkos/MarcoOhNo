import { useEffect, useRef, useCallback } from "react";
import Phaser from "phaser";
import { useGameStore } from "@/lib/gameStore";
import { socket } from "@/lib/socket";
import { MAP_CONFIG, type Player, type GameState } from "@shared/schema";
import { GameHUD } from "./GameHUD";
import { MobileControls } from "./MobileControls";
import { calculateVisionPolygon } from "@/lib/vision";

// Module-level variable to persist visited path across scene restarts (e.g. on resize or re-mount)
// Module-level variable to persist visited path across scene restarts (e.g. on resize or re-mount)
let persistentVisitedPath: { x: number, y: number, radius: number }[] = [];
let persistentRoomCode: string | null = null;

class MobileGameScene extends Phaser.Scene {
  private players: Map<string, Phaser.GameObjects.Container> = new Map();
  private ripMarkers: Map<string, Phaser.GameObjects.Container> = new Map();
  private marcoReveals: Map<string, Phaser.GameObjects.Container> = new Map();

  // Fog components
  private fogGraphics!: Phaser.GameObjects.Graphics;
  private maskGraphics!: Phaser.GameObjects.Graphics;
  private visitedPath: { x: number, y: number, radius: number }[] = persistentVisitedPath;
  private lastVisitedPos: { x: number, y: number } | null = null;
  private lastPhase: string = "";

  private gameState: GameState | null = null;
  private localPlayerId: string | null = null;
  private moveVector = { x: 0, y: 0, angle: 0 };
  private obstacles: Phaser.GameObjects.Rectangle[] = [];
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;

  private wasd!: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };

  constructor() {
    super({ key: "MobileGameScene" });
  }

  init(data: { playerId: string | null }) {
    this.localPlayerId = data.playerId;
  }

  create() {
    this.cameras.main.setBackgroundColor(0x0a0f1a);
    this.createMap();

    // 1. Setup Fog Graphics (The visible blackness)
    this.fogGraphics = this.add.graphics();
    this.fogGraphics.setDepth(1000); // High depth
    this.fogGraphics.fillStyle(0x000000, 1);
    this.fogGraphics.fillRect(0, 0, MAP_CONFIG.width, MAP_CONFIG.height);

    // Add "Waiting for game..." text if no player
    if (!this.localPlayerId) {
      const text = this.add.text(this.cameras.main.centerX, this.cameras.main.centerY, "Spectating / Waiting...", {
        color: '#ffffff', fontSize: '24px'
      });
      text.setOrigin(0.5);
      text.setDepth(2000);
    }

    // 2. Setup Mask Graphics (Invisible, used to define the holes)
    // We use 'make.graphics' because it doesn't need to be added to scene, just used for mask data
    this.maskGraphics = this.make.graphics({ x: 0, y: 0 }, false);

    // 3. Create the Geometry Mask ONCE, or recreate it?
    // GeometryMask reads from the Graphics object. As long as we update the Graphics, the mask updates.
    const mask = this.maskGraphics.createGeometryMask();
    mask.invertAlpha = true; // White shapes in maskGraphics become transparent (holes) in fogGraphics
    this.fogGraphics.setMask(mask);

    this.input.on('pointerdown', () => {
      const soundManager = this.sound as Phaser.Sound.WebAudioSoundManager;
      if (soundManager.context &&
        soundManager.context.state === 'suspended') {
        soundManager.context.resume().catch(() => { });
      }
    });

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    }) as any;

    // Ensure camera operations happen after scene is ready
    this.events.on('update', () => {
      this.updateCamera();
    });
  }

  updateCamera() {
    if (!this.gameState || !this.localPlayerId) return;
    const player = this.gameState.players.find(p => p.id === this.localPlayerId);
    if (player) {
      const container = this.players.get(player.id);
      if (container) {
        this.cameras.main.startFollow(container, true, 0.1, 0.1);
      }
    }
  }

  createMap() {
    const { width, height } = MAP_CONFIG;

    const gridGraphics = this.add.graphics();
    gridGraphics.lineStyle(1, 0x1a2744, 0.3);
    gridGraphics.setDepth(1);

    const gridSize = 40;
    for (let x = 0; x <= width; x += gridSize) {
      gridGraphics.lineBetween(x, 0, x, height);
    }
    for (let y = 0; y <= height; y += gridSize) {
      gridGraphics.lineBetween(0, y, width, y);
    }

    // Walls are dynamic
  }

  updateGameState(state: GameState) {
    // Clear visited path if we go back to lobby or significantly restart OR if room code changed
    if ((this.lastPhase !== "lobby" && state.phase === "lobby") || (persistentRoomCode && persistentRoomCode !== state.roomCode)) {
      persistentVisitedPath.length = 0;
      this.visitedPath = persistentVisitedPath;
      this.lastVisitedPos = null;
    }
    persistentRoomCode = state.roomCode;
    this.lastPhase = state.phase;

    this.gameState = state;
    this.updatePlayers();
    this.updateRipMarkers();
    this.updateMarcoReveals();
    this.updateFogOfWar();
    this.drawMapWalls(state.walls);
  }

  drawMapWalls(walls: { x: number, y: number, w: number, h: number }[]) {
    this.obstacles.forEach(obs => obs.destroy());
    this.obstacles = [];

    walls.forEach(wall => {
      const rect = this.add.rectangle(wall.x, wall.y, wall.w, wall.h, 0x2a3f5f);
      rect.setStrokeStyle(2, 0x3d5a80);
      rect.setDepth(10);
      this.obstacles.push(rect);
    });
  }

  updatePlayers() {
    if (!this.gameState) return;

    // Only show players if they are close (in the vision radius)
    const localPlayer = this.gameState.players.find(p => p.id === this.localPlayerId);
    if (!localPlayer) return;

    const currentPlayerIds = new Set(this.gameState.players.map(p => p.id));

    this.players.forEach((container, id) => {
      if (!currentPlayerIds.has(id)) {
        container.destroy();
        this.players.delete(id);
      }
    });

    this.gameState.players.forEach(player => {
      if (player.status === "caught") {
        const existing = this.players.get(player.id);
        if (existing) {
          existing.destroy();
          this.players.delete(player.id);
        }
        return;
      }

      let container = this.players.get(player.id);

      if (!container) {
        container = this.createPlayerSprite(player);
        this.players.set(player.id, container);
        // Init target props
        container.setData('targetX', player.x);
        container.setData('targetY', player.y);
        container.setData('targetAngle', player.angle);
      }

      // Client-side prediction: Do not overwrite local player position from server
      if (player.id !== this.localPlayerId) {
        // Instead of setting position directly, set TARGET position for interpolation
        container.setData('targetX', player.x);
        container.setData('targetY', player.y);
        container.setData('targetAngle', player.angle);
      } else {
        // Local player: Check for desync (e.g. after respawn)
        // If distance is large (> 150px), snap to server position
        const dist = Phaser.Math.Distance.Between(container.x, container.y, player.x, player.y);
        if (dist > 150) {
          container.setPosition(player.x, player.y);
          // Also reset move vector to prevent "sliding" back
          // But we don't have direct access to moveVector inputs here easily without clearing them?
          // The next update loop will handle input.
        }
      }

      const visionCone = container.getByName("visionCone") as Phaser.GameObjects.Graphics;
      if (visionCone && player.role === "seeker" && player.id === this.localPlayerId) {
        visionCone.clear();
        this.drawVisionCone(visionCone, player.angle);
      }

      // Update Catch Progress
      if (player.catchProgress > 0 && player.role === "runner") {
        const progressBg = container.getByName("progressBg") as Phaser.GameObjects.Rectangle;
        const progressBar = container.getByName("progressBar") as Phaser.GameObjects.Rectangle;
        if (progressBg && progressBar) {
          progressBg.setVisible(true);
          progressBar.setVisible(true);
          progressBar.setScale(player.catchProgress / 100, 1);
        }
      } else {
        const progressBg = container.getByName("progressBg") as Phaser.GameObjects.Rectangle;
        const progressBar = container.getByName("progressBar") as Phaser.GameObjects.Rectangle;
        if (progressBg && progressBar) {
          progressBg.setVisible(false);
          progressBar.setVisible(false);
        }
      }
    });
  }

  createPlayerSprite(player: Player): Phaser.GameObjects.Container {
    const container = this.add.container(player.x, player.y);
    const isLocalPlayer = player.id === this.localPlayerId;

    if (player.role === "seeker") {
      const visionCone = this.add.graphics();
      visionCone.setName("visionCone");
      container.add(visionCone);
      this.drawVisionCone(visionCone, player.angle);
    }

    const color = Phaser.Display.Color.HexStringToColor(player.color).color;
    const body = this.add.circle(0, 0, MAP_CONFIG.playerRadius, color);
    body.setStrokeStyle(isLocalPlayer ? 4 : 2, isLocalPlayer ? 0xffffff : 0xcccccc, 1);
    container.add(body);

    if (player.role === "seeker") {
      const flashlight = this.add.circle(6, -6, 5, 0xffd700);
      flashlight.setName("flashlight");
      container.add(flashlight);
    }

    if (isLocalPlayer) {
      const indicator = this.add.circle(0, 0, MAP_CONFIG.playerRadius + 6, undefined, 0);
      indicator.setStrokeStyle(2, 0xffffff, 0.4);
      container.add(indicator);
    }

    const nameText = this.add.text(0, -MAP_CONFIG.playerRadius - 12, player.name, {
      fontSize: "12px",
      fontFamily: "Rajdhani",
      fontStyle: isLocalPlayer ? "bold" : "normal",
      color: "#ffffff",
      stroke: "#000000",
      strokeThickness: 3,
    });
    nameText.setOrigin(0.5, 1);
    container.add(nameText);

    const progressBg = this.add.rectangle(0, MAP_CONFIG.playerRadius + 8, 30, 4, 0x333333);
    progressBg.setName("progressBg");
    progressBg.setVisible(false);
    container.add(progressBg);

    const progressBar = this.add.rectangle(-15, MAP_CONFIG.playerRadius + 8, 30, 4, 0xff4444);
    progressBar.setName("progressBar");
    progressBar.setOrigin(0, 0.5);
    progressBar.setVisible(false);
    container.add(progressBar);

    container.setDepth(isLocalPlayer ? 150 : (player.role === "seeker" ? 100 : 50));

    return container;
  }

  drawVisionCone(graphics: Phaser.GameObjects.Graphics, angle: number) {
    const { seekerVisionAngle, seekerVisionDistance } = MAP_CONFIG;

    // Use raycasting for realistic shadows
    // We are in a container, so local (0,0) is correct for origin
    // However, calculateVisionPolygon assumes global coordinates for obstacles logic
    // So we calculate in global, then map back to local? 
    // Or we pass global origin to calculateVisionPolygon

    // Container position:
    const container = graphics.parentContainer as Phaser.GameObjects.Container;
    const origin = { x: container.x, y: container.y };

    const polygonPoints = calculateVisionPolygon(
      origin,
      angle,
      seekerVisionAngle,
      seekerVisionDistance,
      this.gameState?.walls || []
    );

    // Convert points back to local space relative to container (subtract origin)
    const localPoints = polygonPoints.map(p => ({ x: p.x - origin.x, y: p.y - origin.y }));

    graphics.clear();
    graphics.fillStyle(0xffd700, 0.2);
    graphics.fillPoints(localPoints, true);

    graphics.lineStyle(2, 0xffd700, 0.5);
    graphics.strokePoints(localPoints, true);
  }

  updateRipMarkers() {
    if (!this.gameState) return;

    this.gameState.players.forEach(player => {
      if (player.status === "caught" && player.ripPosition && !this.ripMarkers.has(player.id)) {
        const container = this.add.container(player.ripPosition.x, player.ripPosition.y);

        const cross = this.add.graphics();
        cross.lineStyle(4, 0xff4444, 0.8);
        cross.lineBetween(-15, -15, 15, 15);
        cross.lineBetween(-15, 15, 15, -15);
        container.add(cross);

        const ripText = this.add.text(0, 25, "RIP", {
          fontSize: "14px",
          fontFamily: "Orbitron",
          color: "#ff4444",
          stroke: "#000000",
          strokeThickness: 2,
        });
        ripText.setOrigin(0.5, 0);
        container.add(ripText);

        container.setDepth(30);
        container.setAlpha(0);

        this.tweens.add({
          targets: container,
          alpha: 1,
          y: player.ripPosition.y,
          duration: 500,
          ease: "Bounce.easeOut",
        });

        this.ripMarkers.set(player.id, container);
      }
    });
  }

  updateMarcoReveals() {
    if (!this.gameState) return;

    const { marcoRevealPlayerId, marcoRevealExpiry } = this.gameState;

    if (marcoRevealPlayerId && marcoRevealExpiry && Date.now() < marcoRevealExpiry) {
      if (marcoRevealPlayerId === this.localPlayerId && !this.marcoReveals.has(marcoRevealPlayerId)) {
        const player = this.gameState.players.find(p => p.id === marcoRevealPlayerId);
        if (player) {
          const container = this.add.container(player.x, player.y);

          const ring = this.add.circle(0, 0, 40, undefined, 0);
          ring.setStrokeStyle(4, 0xcc66ff, 1);
          container.add(ring);

          const ohNoText = this.add.text(0, -50, "OH NO!", {
            fontSize: "18px",
            fontFamily: "Orbitron",
            color: "#cc66ff",
            stroke: "#000000",
            strokeThickness: 3,
          });
          ohNoText.setOrigin(0.5, 1);
          container.add(ohNoText);

          // Ensure this renders ABOVE fog (fog is 1000)
          container.setDepth(2000);

          this.tweens.add({
            targets: ring,
            scaleX: 2.5,
            scaleY: 2.5,
            alpha: 0,
            duration: 2000,
            ease: "Power2",
            onComplete: () => {
              container.destroy();
              this.marcoReveals.delete(marcoRevealPlayerId);
            },
          });

          this.marcoReveals.set(marcoRevealPlayerId, container);
        }
      }
    }
  }

  updateFogOfWar() {
    if (!this.gameState || !this.fogGraphics || !this.maskGraphics) return;

    const localPlayer = this.gameState.players.find(p => p.id === this.localPlayerId);
    if (!localPlayer) return;

    // 1. Update Visited Path (add new circle if moved enough)
    let radius = MAP_CONFIG.runnerVisionRadius;
    if (localPlayer.role === 'seeker') {
      radius = 60; // Smaller radius for seeker persistent trail? Or same?
      // Actually seeker shows Vision Cone, but maybe also a small circle around them?
    }

    // Determine if we need to add a new visited node
    if (!this.lastVisitedPos) {
      this.visitedPath.push({ x: localPlayer.x, y: localPlayer.y, radius });
      this.lastVisitedPos = { x: localPlayer.x, y: localPlayer.y };
    } else {
      const distSq = (localPlayer.x - this.lastVisitedPos.x) ** 2 + (localPlayer.y - this.lastVisitedPos.y) ** 2;
      // Add node if moved ~40px
      if (distSq > 40 * 40) {
        this.visitedPath.push({ x: localPlayer.x, y: localPlayer.y, radius });
        this.lastVisitedPos = { x: localPlayer.x, y: localPlayer.y };
      }
    }

    // 2. Clear and Redraw the Fog (Black Overlay)
    this.fogGraphics.clear();
    this.fogGraphics.fillStyle(0x000000, 1);
    this.fogGraphics.fillRect(0, 0, MAP_CONFIG.width, MAP_CONFIG.height);

    // 3. Clear and Redraw the Mask Shape (The holes in the fog)
    this.maskGraphics.clear();
    this.maskGraphics.fillStyle(0xffffff);

    // Draw all visited path circles (The "Trail")
    // NOTE: If this path gets too long (thousands), we might need to optimize 
    // by using a RenderTexture for the mask source instead.
    // But for < few mins game, a few hundred circles is fine in WebGL.
    // Draw server-synced explored areas (restores history on reload)
    // Filter by role: Seeker sees only Seeker paths, Runners see only Runner paths
    this.gameState.exploredAreas.forEach(area => {
      // If no source (legacy), assume it belongs to everyone or handle gracefully? 
      // Schema says optional, but we just added it. Assume persistence not an issue for fresh dev server.
      // If source is missing, don't show to Seeker to be safe? Or show?
      // Better:
      const areaSource = area.source || "seeker"; // Default to seeker if undefined (legacy behavior)

      const myRole = localPlayer.role === "seeker" ? "seeker" : "runner";

      // Seeker only sees Seeker trails
      // Runners only see Runner trails (shared team vision)
      if (areaSource === myRole) {
        this.maskGraphics.fillCircle(area.x, area.y, area.radius);
      }
    });

    // Draw local visited path (immediate feedback)
    this.visitedPath.forEach(point => {
      this.maskGraphics.fillCircle(point.x, point.y, point.radius);
    });

    // Draw Current Vision (Bright Spot)
    if (localPlayer.role === 'seeker') {
      const { seekerVisionAngle, seekerVisionDistance } = MAP_CONFIG;
      const startAngle = Phaser.Math.DegToRad(localPlayer.angle - seekerVisionAngle / 2);
      const endAngle = Phaser.Math.DegToRad(localPlayer.angle + seekerVisionAngle / 2);

      // Use polygon for wall-aware vision
      const polygonPoints = calculateVisionPolygon(
        { x: localPlayer.x, y: localPlayer.y },
        localPlayer.angle,
        seekerVisionAngle,
        seekerVisionDistance,
        this.gameState?.walls || []
      );

      this.maskGraphics.beginPath();
      this.maskGraphics.moveTo(localPlayer.x, localPlayer.y);
      this.maskGraphics.fillPoints(polygonPoints, true, true);
      this.maskGraphics.closePath();
      // this.maskGraphics.fillPath(); // fillPoints does the fill

      // Also a small circle around seeker
      this.maskGraphics.fillCircle(localPlayer.x, localPlayer.y, 60);

    } else {
      // Runner
      this.maskGraphics.fillCircle(localPlayer.x, localPlayer.y, radius);
    }

    // Geometry Mask updates automatically because it references the Graphics object
  }

  setMoveVector(x: number, y: number, angle: number) {
    this.moveVector = { x, y, angle };
  }

  update(time: number, delta: number) {
    if (!this.gameState || this.gameState.phase !== "playing") return;

    // Interpolate Remote Players
    const t = 0.15;
    this.players.forEach((container, id) => {
      if (id === this.localPlayerId) return;

      const targetX = container.getData('targetX');
      const targetY = container.getData('targetY');
      const targetAngle = container.getData('targetAngle');

      if (targetX !== undefined && targetY !== undefined && targetAngle !== undefined) {
        container.x = Phaser.Math.Linear(container.x, targetX, t);
        container.y = Phaser.Math.Linear(container.y, targetY, t);

        const currentAngle = container.getData('currentAngle') || 0;
        const diff = Phaser.Math.Angle.ShortestBetween(currentAngle, targetAngle);
        const newAngle = currentAngle + diff * t;
        container.setData('currentAngle', newAngle);

        // Update Flashlight
        const flashlight = container.getByName("flashlight") as Phaser.GameObjects.Shape;
        if (flashlight) {
          const rad = Phaser.Math.DegToRad(newAngle);
          flashlight.x = Math.cos(rad) * 12; // Radius 12
          flashlight.y = Math.sin(rad) * 12;
        }

        // Update Vision Cone
        const visionCone = container.getByName("visionCone") as Phaser.GameObjects.Graphics;
        if (visionCone) {
          visionCone.clear();
          this.drawVisionCone(visionCone, newAngle);
        }
      }
    });

    const localPlayer = this.gameState.players.find(p => p.id === this.localPlayerId);
    if (!localPlayer || localPlayer.status === "caught") return;

    const speed = 7; // Increased speed
    let dx = 0;
    let dy = 0;

    // Joystick overrides keyboard if active
    if (this.moveVector.x !== 0 || this.moveVector.y !== 0) {
      dx = this.moveVector.x;
      dy = this.moveVector.y;
      // Normalize joystick vector to ensure consistent speed (match WASD)
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        dx /= len;
        dy /= len;
      }
    } else {
      // Keyboard controls
      if (this.cursors.left.isDown || this.wasd.left.isDown) dx = -1;
      else if (this.cursors.right.isDown || this.wasd.right.isDown) dx = 1;

      if (this.cursors.up.isDown || this.wasd.up.isDown) dy = -1;
      else if (this.cursors.down.isDown || this.wasd.down.isDown) dy = 1;

      if (dx !== 0 || dy !== 0) {
        // Normalize
        const len = Math.sqrt(dx * dx + dy * dy);
        dx /= len;
        dy /= len;

        this.moveVector.angle = Math.atan2(dy, dx) * (180 / Math.PI);
      }
    }

    // Determine target position based on LOCAL container position (Client-side prediction)
    // This prevents jitter when server update is lagging/rejecting
    const container = this.players.get(localPlayer.id);
    if (!container) return;

    let nextX = container.x + dx * speed;
    let nextY = container.y + dy * speed;

    // Check X Axis Collision
    let testRectX = { x: nextX - 16, y: localPlayer.y - 16, w: 32, h: 32 };
    const walls = this.gameState.walls || [];
    const collidedX = walls.some(obs => {
      return (testRectX.x < obs.x + obs.w / 2 &&
        testRectX.x + testRectX.w > obs.x - obs.w / 2 &&
        testRectX.y < obs.y + obs.h / 2 &&
        testRectX.y + testRectX.h > obs.y - obs.h / 2);
    });

    // Check Y Axis Collision
    let testRectY = { x: localPlayer.x - 16, y: nextY - 16, w: 32, h: 32 };
    const collidedY = walls.some(obs => {
      return (testRectY.x < obs.x + obs.w / 2 &&
        testRectY.x + testRectY.w > obs.x - obs.w / 2 &&
        testRectY.y < obs.y + obs.h / 2 &&
        testRectY.y + testRectY.h > obs.y - obs.h / 2);
    });

    if (collidedX) {
      nextX = container.x; // Block X movement, stay at local position
      dx = 0;
    }
    if (collidedY) {
      nextY = container.y; // Block Y movement, stay at local position
      dy = 0;
    }

    const clampedX = Phaser.Math.Clamp(nextX, MAP_CONFIG.playerRadius, MAP_CONFIG.width - MAP_CONFIG.playerRadius);
    const clampedY = Phaser.Math.Clamp(nextY, MAP_CONFIG.playerRadius, MAP_CONFIG.height - MAP_CONFIG.playerRadius);

    // Only emit if *actually* moving (and sliding counted as moving)
    // Emit if moving OR rotating
    const currentAngle = this.moveVector.angle;
    
    // Check previous angle from container data
    const lastEmittedAngle = container.getData('lastEmittedAngle') || 0;

    // Check if angle changed significantly (e.g. > 0.1 degree)
    const angleChanged = Math.abs(currentAngle - lastEmittedAngle) > 0.1;
    const posChanged = clampedX !== localPlayer.x || clampedY !== localPlayer.y;

    if (posChanged || angleChanged) {
      // Update local state IMMEDIATELY for smoothness
      localPlayer.x = clampedX;
      localPlayer.y = clampedY;

      container.setPosition(clampedX, clampedY);
      container.setData('lastEmittedAngle', currentAngle);

      socket.emit("movePlayer", clampedX, clampedY, currentAngle);
    }

    this.updatePlayerVisibility();
  }

  updatePlayerVisibility() {
    if (!this.gameState || !this.localPlayerId) return;
    const localPlayer = this.gameState.players.find(p => p.id === this.localPlayerId);
    if (!localPlayer) return;

    if (localPlayer.role === 'seeker') {
      const { seekerVisionAngle, seekerVisionDistance } = MAP_CONFIG;

      const polygonPoints = calculateVisionPolygon(
        { x: localPlayer.x, y: localPlayer.y },
        localPlayer.angle,
        seekerVisionAngle,
        seekerVisionDistance,
        this.gameState.walls || []
      );

      const visionPoly = new Phaser.Geom.Polygon(polygonPoints);

      this.players.forEach((container, id) => {
        if (id === this.localPlayerId) {
          container.setVisible(true);
          return;
        }

        // Always hide other players by default unless caught
        let isVisible = false;

        const player = this.gameState!.players.find(p => p.id === id);
        if (player && player.status === 'caught') {
          // Caught players are always visible (or maybe usually visible? Assumed yes for now)
          isVisible = true;
        } else {
          // Verify if in flashlight cone or very close proximity
          const dist = Phaser.Math.Distance.Between(localPlayer.x, localPlayer.y, container.x, container.y);
          if (dist < 60) {
            isVisible = true;
          } else if (visionPoly.contains(container.x, container.y)) {
            // Also check if line of sight is blocked? 
            // calculateVisionPolygon already accounts for walls in the shape.
            // If the point (center of player) is in the polygon, it's visible.
            isVisible = true;
          }
        }

        container.setVisible(isVisible);
      });

    } else {
      // Runner: Rely on Fog of War (or ensure default visibility)
      // If we previously hid them as seeker, we need to show them again if role swapped.
      this.players.forEach(container => container.setVisible(true));
    }
  }
}

export function MobileGameView() {
  const gameRef = useRef<Phaser.Game | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<MobileGameScene | null>(null);
  const { gameState, playerId } = useGameStore();

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: MAP_CONFIG.width,
      height: MAP_CONFIG.height,
      backgroundColor: "#0a0f1a",
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene: MobileGameScene,
    };

    gameRef.current = new Phaser.Game(config);

    gameRef.current.events.once("ready", () => {
      const scene = gameRef.current?.scene.getScene("MobileGameScene") as MobileGameScene;
      if (scene) {
        scene.scene.restart({ playerId });
        sceneRef.current = scene;
      }
    });

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
      sceneRef.current = null;
    };
  }, [playerId]);

  useEffect(() => {
    if (sceneRef.current && gameState) {
      sceneRef.current.updateGameState(gameState);
    }
  }, [gameState]);

  const handleMove = useCallback((dx: number, dy: number, angle: number) => {
    if (sceneRef.current) {
      sceneRef.current.setMoveVector(dx, dy, angle);
    }
  }, []);

  return (
    <div className="relative w-full h-screen bg-background overflow-hidden">
      <div
        ref={containerRef}
        className="w-full h-full"
        data-testid="game-canvas-mobile"
      />
      <GameHUD isTVView={false} />
      <MobileControls onMove={handleMove} />
    </div>
  );
}
