import { useEffect, useRef, useCallback } from "react";
import Phaser from "phaser";
import { useGameStore } from "@/lib/gameStore";
import { socket } from "@/lib/socket";
import { MAP_CONFIG, type Player, type GameState } from "@shared/schema";

interface PhaserGameProps {
  isTVView: boolean;
}

class GameScene extends Phaser.Scene {
  private players: Map<string, Phaser.GameObjects.Container> = new Map();
  private ripMarkers: Map<string, Phaser.GameObjects.Container> = new Map();
  private marcoReveals: Map<string, Phaser.GameObjects.Container> = new Map();
  private fogGraphics!: Phaser.GameObjects.Graphics;
  private visionMask!: Phaser.GameObjects.Graphics;
  private exploredMask!: Phaser.GameObjects.Graphics;
  private gameState: GameState | null = null;
  private isTVView: boolean = false;
  private localPlayerId: string | null = null;
  private moveVector = { x: 0, y: 0, angle: 0 };
  private obstacles: Phaser.GameObjects.Rectangle[] = [];

  constructor() {
    super({ key: "GameScene" });
  }

  init(data: { isTVView: boolean; playerId: string | null }) {
    this.isTVView = data.isTVView;
    this.localPlayerId = data.playerId;
  }

  create() {
    const { width, height } = MAP_CONFIG;
    
    this.cameras.main.setBackgroundColor(0x0a0f1a);
    
    this.createMap();
    
    this.fogGraphics = this.add.graphics();
    this.visionMask = this.add.graphics();
    this.exploredMask = this.add.graphics();
    
    if (!this.isTVView) {
      this.input.addPointer(1);
    }
  }

  createMap() {
    const { width, height } = MAP_CONFIG;
    
    const gridGraphics = this.add.graphics();
    gridGraphics.lineStyle(1, 0x1a2744, 0.3);
    
    const gridSize = 40;
    for (let x = 0; x <= width; x += gridSize) {
      gridGraphics.lineBetween(x, 0, x, height);
    }
    for (let y = 0; y <= height; y += gridSize) {
      gridGraphics.lineBetween(0, y, width, y);
    }
    
    const obstaclePositions = [
      { x: 200, y: 200, w: 80, h: 80 },
      { x: 400, y: 150, w: 120, h: 60 },
      { x: 600, y: 300, w: 60, h: 120 },
      { x: 900, y: 200, w: 100, h: 100 },
      { x: 300, y: 500, w: 80, h: 80 },
      { x: 700, y: 550, w: 150, h: 60 },
      { x: 1000, y: 450, w: 80, h: 120 },
      { x: 150, y: 650, w: 100, h: 80 },
      { x: 500, y: 700, w: 60, h: 60 },
      { x: 850, y: 680, w: 120, h: 80 },
    ];
    
    obstaclePositions.forEach(obs => {
      const obstacle = this.add.rectangle(
        obs.x, obs.y, obs.w, obs.h, 0x2a3f5f
      );
      obstacle.setStrokeStyle(2, 0x3d5a80);
      this.obstacles.push(obstacle);
    });
  }

  updateGameState(state: GameState) {
    this.gameState = state;
    this.updatePlayers();
    this.updateRipMarkers();
    this.updateMarcoReveals();
    this.updateFogOfWar();
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
      this.drawVisionCone(visionCone, player.angle);
      container.add(visionCone);
    }
    
    const color = Phaser.Display.Color.HexStringToColor(player.color).color;
    const body = this.add.circle(0, 0, MAP_CONFIG.playerRadius, color);
    body.setStrokeStyle(3, 0xffffff, player.role === "seeker" ? 1 : 0.6);
    container.add(body);
    
    if (player.role === "seeker") {
      const flashlight = this.add.circle(6, -6, 5, 0xffd700);
      container.add(flashlight);
    }
    
    const nameText = this.add.text(0, -MAP_CONFIG.playerRadius - 12, player.name, {
      fontSize: "12px",
      fontFamily: "Rajdhani",
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
    
    container.setDepth(player.role === "seeker" ? 100 : 50);
    
    return container;
  }

  drawVisionCone(graphics: Phaser.GameObjects.Graphics, angle: number) {
    const { seekerVisionAngle, seekerVisionDistance } = MAP_CONFIG;
    const startAngle = Phaser.Math.DegToRad(angle - seekerVisionAngle / 2);
    const endAngle = Phaser.Math.DegToRad(angle + seekerVisionAngle / 2);
    
    graphics.clear();
    graphics.fillStyle(0xffd700, 0.15);
    graphics.beginPath();
    graphics.moveTo(0, 0);
    graphics.arc(0, 0, seekerVisionDistance, startAngle, endAngle, false);
    graphics.closePath();
    graphics.fillPath();
    
    graphics.lineStyle(2, 0xffd700, 0.4);
    graphics.beginPath();
    graphics.moveTo(0, 0);
    graphics.arc(0, 0, seekerVisionDistance, startAngle, endAngle, false);
    graphics.closePath();
    graphics.strokePath();
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
        
        const nameText = this.add.text(0, 42, player.name, {
          fontSize: "10px",
          fontFamily: "Rajdhani",
          color: "#888888",
        });
        nameText.setOrigin(0.5, 0);
        container.add(nameText);
        
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
      if (!this.marcoReveals.has(marcoRevealPlayerId)) {
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
          
          container.setDepth(200);
          
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
    if (!this.gameState) return;
    
    const { width, height } = MAP_CONFIG;
    
    this.fogGraphics.clear();
    this.fogGraphics.setDepth(1000);
    
    if (this.isTVView) {
      this.fogGraphics.fillStyle(0x050810, 0.85);
      this.fogGraphics.fillRect(0, 0, width, height);
      
      this.fogGraphics.setBlendMode(Phaser.BlendModes.ERASE);
      
      this.gameState.exploredAreas.forEach(area => {
        const gradient = this.fogGraphics.createGeometryMask();
        this.fogGraphics.fillStyle(0xffffff, 1);
        this.fogGraphics.fillCircle(area.x, area.y, area.radius);
      });
      
      const seeker = this.gameState.players.find(p => p.role === "seeker");
      if (seeker) {
        this.fogGraphics.fillStyle(0xffffff, 1);
        this.drawVisionConeClip(this.fogGraphics, seeker.x, seeker.y, seeker.angle);
      }
      
      this.fogGraphics.setBlendMode(Phaser.BlendModes.NORMAL);
      
    } else {
      const localPlayer = this.gameState.players.find(p => p.id === this.localPlayerId);
      if (!localPlayer) return;
      
      this.fogGraphics.fillStyle(0x050810, 0.9);
      this.fogGraphics.fillRect(0, 0, width, height);
      
      this.fogGraphics.setBlendMode(Phaser.BlendModes.ERASE);
      
      if (localPlayer.role === "seeker") {
        this.drawVisionConeClip(this.fogGraphics, localPlayer.x, localPlayer.y, localPlayer.angle);
      } else {
        this.fogGraphics.fillStyle(0xffffff, 1);
        this.fogGraphics.fillCircle(localPlayer.x, localPlayer.y, MAP_CONFIG.runnerVisionRadius);
      }
      
      this.fogGraphics.setBlendMode(Phaser.BlendModes.NORMAL);
      
      this.cameras.main.centerOn(localPlayer.x, localPlayer.y);
    }
  }

  drawVisionConeClip(graphics: Phaser.GameObjects.Graphics, x: number, y: number, angle: number) {
    const { seekerVisionAngle, seekerVisionDistance } = MAP_CONFIG;
    const startAngle = Phaser.Math.DegToRad(angle - seekerVisionAngle / 2);
    const endAngle = Phaser.Math.DegToRad(angle + seekerVisionAngle / 2);
    
    graphics.fillStyle(0xffffff, 1);
    graphics.beginPath();
    graphics.moveTo(x, y);
    graphics.arc(x, y, seekerVisionDistance, startAngle, endAngle, false);
    graphics.closePath();
    graphics.fillPath();
    
    graphics.fillCircle(x, y, 50);
  }

  setMoveVector(x: number, y: number, angle: number) {
    this.moveVector = { x, y, angle };
  }

  update(time: number, delta: number) {
    if (!this.gameState || this.gameState.phase !== "playing") return;
    
    const localPlayer = this.gameState.players.find(p => p.id === this.localPlayerId);
    if (!localPlayer || localPlayer.status === "caught") return;
    
    const speed = 3;
    const newX = localPlayer.x + this.moveVector.x * speed;
    const newY = localPlayer.y + this.moveVector.y * speed;
    
    const clampedX = Phaser.Math.Clamp(newX, MAP_CONFIG.playerRadius, MAP_CONFIG.width - MAP_CONFIG.playerRadius);
    const clampedY = Phaser.Math.Clamp(newY, MAP_CONFIG.playerRadius, MAP_CONFIG.height - MAP_CONFIG.playerRadius);
    
    if (this.moveVector.x !== 0 || this.moveVector.y !== 0) {
      socket.emit("movePlayer", clampedX, clampedY, this.moveVector.angle);
    }
  }
}

export function PhaserGame({ isTVView }: PhaserGameProps) {
  const gameRef = useRef<Phaser.Game | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GameScene | null>(null);
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
      scene: GameScene,
    };

    gameRef.current = new Phaser.Game(config);
    
    gameRef.current.events.once("ready", () => {
      const scene = gameRef.current?.scene.getScene("GameScene") as GameScene;
      if (scene) {
        scene.scene.restart({ isTVView, playerId });
        sceneRef.current = scene;
      }
    });

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
      sceneRef.current = null;
    };
  }, [isTVView, playerId]);

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
    <div 
      ref={containerRef} 
      className="w-full h-full"
      data-testid="game-canvas"
    />
  );
}

export function usePhaserMove() {
  const sceneRef = useRef<GameScene | null>(null);
  
  const setScene = (scene: GameScene) => {
    sceneRef.current = scene;
  };
  
  const handleMove = (dx: number, dy: number, angle: number) => {
    if (sceneRef.current) {
      sceneRef.current.setMoveVector(dx, dy, angle);
    }
  };
  
  return { setScene, handleMove };
}
