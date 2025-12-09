import { useEffect, useRef, useCallback } from "react";
import Phaser from "phaser";
import { useGameStore } from "@/lib/gameStore";
import { MAP_CONFIG, type Player, type GameState } from "@shared/schema";
import { GameHUD } from "./GameHUD";
import { calculateVisionPolygon, isPointVisible } from "@/lib/vision";

class TVGameScene extends Phaser.Scene {
  private players: Map<string, Phaser.GameObjects.Container> = new Map();
  private ripMarkers: Map<string, Phaser.GameObjects.Container> = new Map();
  private marcoReveals: Map<string, Phaser.GameObjects.Container> = new Map();
  private fogGraphics!: Phaser.GameObjects.Graphics;
  private exploredGraphics!: Phaser.GameObjects.Graphics;
  private gameState: GameState | null = null;
  private obstacles: Phaser.GameObjects.Rectangle[] = [];

  constructor() {
    super({ key: "TVGameScene" });
  }

  create() {
    this.cameras.main.setBackgroundColor(0x0a0f1a);
    this.createMap();
    this.exploredGraphics = this.add.graphics();
    this.exploredGraphics.setDepth(5);
    this.fogGraphics = this.add.graphics();
    this.fogGraphics.setDepth(1000);
    this.fogGraphics.fillStyle(0x000000, 1);
    this.fogGraphics.fillRect(0, 0, MAP_CONFIG.width, MAP_CONFIG.height);
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

    // Walls are now dynamic from GameState
  }

  updateGameState(state: GameState) {
    this.gameState = state;
    this.updatePlayers();
    this.updateRipMarkers();
    this.updateMarcoReveals();
    this.updateFogOfWar();

    // Update map walls from server
    if (state.walls) {
      this.drawMapWalls(state.walls);
    }
  }

  drawMapWalls(walls: { x: number, y: number, w: number, h: number }[]) {
    // Clear existing walls
    this.obstacles.forEach(obs => obs.destroy());
    this.obstacles = [];

    // Draw new walls
    walls.forEach(wall => {
      const rect = this.add.rectangle(
        wall.x, wall.y, wall.w, wall.h, 0x2a3f5f
      );
      rect.setStrokeStyle(2, 0x3d5a80);
      rect.setDepth(10);
      this.obstacles.push(rect);
    });
  }

  updatePlayers() {
    if (!this.gameState) return;

    const currentPlayerIds = new Set(this.gameState.players.map(p => p.id));

    this.players.forEach((container, id) => {
      if (!currentPlayerIds.has(id)) {
        container.destroy();
        this.players.delete(id);
      }
    });

    const seeker = this.gameState.players.find(p => p.role === "seeker");

    this.gameState.players.forEach(player => {
      let visible = false;

      // 1. Seeker is always visible
      if (player.role === "seeker") {
        visible = true;
      }
      // 2. Caught runners are visible
      else if (player.status === "caught") {
        visible = true;
      }
      // 3. Runners in Seeker's Vision Cone are visible
      else if (seeker && player.role === "runner") {
        // Check simple distance first
        const dx = player.x - seeker.x;
        const dy = player.y - seeker.y;
        const distSq = dx * dx + dy * dy;
        const maxDist = MAP_CONFIG.seekerVisionDistance;

        if (distSq <= maxDist * maxDist) {
          // Check angle
          const angleToTarget = Math.atan2(dy, dx) * (180 / Math.PI);
          let angleDiff = Math.abs(seeker.angle - angleToTarget);
          while (angleDiff > 180) angleDiff -= 360;
          while (angleDiff < -180) angleDiff += 360;
          angleDiff = Math.abs(angleDiff);

          if (angleDiff <= MAP_CONFIG.seekerVisionAngle / 2) {
            // Check LOS to ensure walls block vision
            const hasLineOfSight = isPointVisible(
              { x: seeker.x, y: seeker.y },
              { x: player.x, y: player.y },
              this.gameState?.walls || []
            );

            if (hasLineOfSight) {
              visible = true;
            }
          }
        }
      }

      if (!visible) {
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
      }

      container.setPosition(player.x, player.y);

      const visionCone = container.getByName("visionCone") as Phaser.GameObjects.Graphics;
      if (visionCone && player.role === "seeker") {
        visionCone.clear();
        this.drawVisionCone(visionCone, player.angle);
      }

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

    if (player.role === "seeker") {
      const visionCone = this.add.graphics();
      visionCone.setName("visionCone");
      container.add(visionCone);
      this.drawVisionCone(visionCone, player.angle);
    }

    const color = Phaser.Display.Color.HexStringToColor(player.color).color;
    const body = this.add.circle(0, 0, MAP_CONFIG.playerRadius, color);
    body.setStrokeStyle(3, 0xffffff, player.role === "seeker" ? 1 : 0.6);
    container.add(body);

    if (player.role === "seeker") {
      const flashlight = this.add.circle(6, -6, 5, 0xffd700);
      container.add(flashlight);
    }

    const nameText = this.add.text(0, -MAP_CONFIG.playerRadius - 14, player.name, {
      fontSize: "14px",
      fontFamily: "Rajdhani",
      fontStyle: "bold",
      color: "#ffffff",
      stroke: "#000000",
      strokeThickness: 4,
    });
    nameText.setOrigin(0.5, 1);
    container.add(nameText);

    const progressBg = this.add.rectangle(0, MAP_CONFIG.playerRadius + 10, 40, 6, 0x333333);
    progressBg.setName("progressBg");
    progressBg.setVisible(false);
    container.add(progressBg);

    const progressBar = this.add.rectangle(-20, MAP_CONFIG.playerRadius + 10, 40, 6, 0xff4444);
    progressBar.setName("progressBar");
    progressBar.setOrigin(0, 0.5);
    progressBar.setVisible(false);
    container.add(progressBar);

    container.setDepth(player.role === "seeker" ? 100 : 50);

    return container;
  }

  drawVisionCone(graphics: Phaser.GameObjects.Graphics, angle: number) {
    const { seekerVisionAngle, seekerVisionDistance } = MAP_CONFIG;

    const container = graphics.parentContainer as Phaser.GameObjects.Container;
    const origin = { x: container.x, y: container.y };

    // Calculate polygon in global space
    const polygonPoints = calculateVisionPolygon(
      origin,
      angle,
      seekerVisionAngle,
      seekerVisionDistance,
      this.gameState?.walls || []
    );

    // Map back to local space
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

        const bgCircle = this.add.circle(0, 0, 30, 0x000000, 0.7);
        container.add(bgCircle);

        const cross = this.add.graphics();
        cross.lineStyle(5, 0xff4444, 1);
        cross.lineBetween(-18, -18, 18, 18);
        cross.lineBetween(-18, 18, 18, -18);
        container.add(cross);

        const ripText = this.add.text(0, 35, "RIP", {
          fontSize: "16px",
          fontFamily: "Orbitron",
          color: "#ff4444",
          stroke: "#000000",
          strokeThickness: 3,
        });
        ripText.setOrigin(0.5, 0);
        container.add(ripText);

        const nameText = this.add.text(0, 54, player.name, {
          fontSize: "12px",
          fontFamily: "Rajdhani",
          color: "#888888",
          stroke: "#000000",
          strokeThickness: 2,
        });
        nameText.setOrigin(0.5, 0);
        container.add(nameText);

        container.setDepth(30);
        container.setAlpha(0);
        container.setScale(0.5);
        container.y -= 30;

        this.tweens.add({
          targets: container,
          alpha: 1,
          y: player.ripPosition.y,
          scaleX: 1,
          scaleY: 1,
          duration: 600,
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
      if (!this.marcoReveals.has(marcoRevealPlayerId)) {
        const player = this.gameState.players.find(p => p.id === marcoRevealPlayerId);
        if (player) {
          const container = this.add.container(player.x, player.y);

          const ring1 = this.add.circle(0, 0, 50, undefined, 0);
          ring1.setStrokeStyle(4, 0xcc66ff, 1);
          container.add(ring1);

          const ring2 = this.add.circle(0, 0, 30, undefined, 0);
          ring2.setStrokeStyle(3, 0xcc66ff, 0.7);
          container.add(ring2);

          const ohNoText = this.add.text(0, -65, "OH NO!", {
            fontSize: "24px",
            fontFamily: "Orbitron",
            color: "#cc66ff",
            stroke: "#000000",
            strokeThickness: 4,
          });
          ohNoText.setOrigin(0.5, 1);
          container.add(ohNoText);

          container.setDepth(2000);

          this.tweens.add({
            targets: ring1,
            scaleX: 3,
            scaleY: 3,
            alpha: 0,
            duration: 2000,
            ease: "Power2",
          });

          this.tweens.add({
            targets: ring2,
            scaleX: 2,
            scaleY: 2,
            alpha: 0,
            duration: 1500,
            ease: "Power2",
          });

          this.tweens.add({
            targets: ohNoText,
            y: -85,
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
    if (!this.gameState) return;

    const { width, height } = MAP_CONFIG;

    this.exploredGraphics.clear();
    this.gameState.exploredAreas.forEach(area => {
      this.exploredGraphics.fillStyle(0x1a2744, 0.3);
      this.exploredGraphics.fillCircle(area.x, area.y, area.radius);
    });

    this.fogGraphics.clear();
    this.fogGraphics.fillStyle(0x000000, 1);
    this.fogGraphics.fillRect(0, 0, width, height);

    const maskShape = this.make.graphics({ x: 0, y: 0 });
    maskShape.fillStyle(0xffffff);

    this.gameState.exploredAreas.forEach(area => {
      maskShape.fillCircle(area.x, area.y, area.radius);
    });

    const seeker = this.gameState.players.find(p => p.role === "seeker");
    if (seeker) {
      const { seekerVisionAngle, seekerVisionDistance } = MAP_CONFIG;

      // Use the same polygon calculation as the visual cone to respect walls
      const polygonPoints = calculateVisionPolygon(
        { x: seeker.x, y: seeker.y },
        seeker.angle,
        seekerVisionAngle,
        seekerVisionDistance,
        this.gameState?.walls || []
      );

      maskShape.fillPoints(polygonPoints, true, true);
      maskShape.fillCircle(seeker.x, seeker.y, 60);
    }

    const mask = maskShape.createGeometryMask();
    mask.invertAlpha = true;
    this.fogGraphics.setMask(mask);
  }
}

export function TVGameView() {
  const gameRef = useRef<Phaser.Game | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<TVGameScene | null>(null);
  const { gameState } = useGameStore();

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
      scene: TVGameScene,
    };

    gameRef.current = new Phaser.Game(config);

    gameRef.current.events.once("ready", () => {
      sceneRef.current = gameRef.current?.scene.getScene("TVGameScene") as TVGameScene;
    });

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (sceneRef.current && gameState) {
      sceneRef.current.updateGameState(gameState);
    }
  }, [gameState]);

  return (
    <div className="relative w-full h-full bg-background">
      <div
        ref={containerRef}
        className="w-full h-full"
        data-testid="game-canvas-tv"
      />
      <GameHUD isTVView={true} />
    </div>
  );
}
