import type { Express } from "express";
import { createServer, type Server } from "http";
import { Server as SocketIOServer } from "socket.io";
import { log } from "./index";
import { generateMaze } from "./maze";
import {
  type GameState,
  type Player,
  type ClientType,
  type ServerToClientEvents,
  type ClientToServerEvents,
  PlayerRole,
  PlayerStatus,
  GamePhase,
  PLAYER_COLORS,
  MAP_CONFIG,
} from "@shared/schema";

interface SocketData {
  roomCode: string | null;
  playerId: string | null;
  clientType: ClientType | null;
}

const rooms = new Map<string, GameState>();
const gameIntervals = new Map<string, NodeJS.Timeout>();

function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function generatePlayerId(): string {
  return Math.random().toString(36).substring(2, 9);
}


function rectIntersectsRect(r1: { x: number, y: number, w: number, h: number }, r2: { x: number, y: number, w: number, h: number }): boolean {
  return (r1.x < r2.x + r2.w &&
    r1.x + r1.w > r2.x &&
    r1.y < r2.y + r2.h &&
    r1.y + r1.h > r2.y);
}

function getRandomSpawnPosition(walls: { x: number, y: number, w: number, h: number }[]): { x: number; y: number } {
  const CELL_SIZE = 120;
  // Recalculate offsets to match maze.ts
  const cols = Math.floor(MAP_CONFIG.width / CELL_SIZE);
  const rows = Math.floor(MAP_CONFIG.height / CELL_SIZE);
  const totalMazeWidth = cols * CELL_SIZE;
  const totalMazeHeight = rows * CELL_SIZE;
  const offsetX = (MAP_CONFIG.width - totalMazeWidth) / 2;
  const offsetY = (MAP_CONFIG.height - totalMazeHeight) / 2;

  let attempts = 0;
  while (attempts < 100) {
    // Pick random cell
    const c = Math.floor(Math.random() * cols);
    const r = Math.floor(Math.random() * rows);

    // Center of cell
    const x = offsetX + c * CELL_SIZE + CELL_SIZE / 2;
    const y = offsetY + r * CELL_SIZE + CELL_SIZE / 2;

    // Small jitter to not be perfectly centered?
    // Let's add +/- 20px jitter
    const jitterX = (Math.random() - 0.5) * 40;
    const jitterY = (Math.random() - 0.5) * 40;

    const finalX = x + jitterX;
    const finalY = y + jitterY;

    // check collisions with the internal pillars if any
    const pRect = {
      x: finalX - MAP_CONFIG.playerRadius,
      y: finalY - MAP_CONFIG.playerRadius,
      w: MAP_CONFIG.playerRadius * 2,
      h: MAP_CONFIG.playerRadius * 2
    };

    const collision = walls.some(wall => {
      const wallRect = {
        x: wall.x - wall.w / 2,
        y: wall.y - wall.h / 2,
        w: wall.w,
        h: wall.h
      };
      return rectIntersectsRect(pRect, wallRect);
    });

    if (!collision) return { x: finalX, y: finalY };
    attempts++;
  }

  // Fallback to center
  return { x: MAP_CONFIG.width / 2, y: MAP_CONFIG.height / 2 };
}

function createPlayer(id: string, name: string, colorIndex: number): Player {
  const spawn = getRandomSpawnPosition([]); // No walls in lobby essentially, or use OBSTACLES if we want waiting room to match?
  // Actually, lobby doesn't have the maze yet. Maze is generated on startGame.
  // So random spawn is fine.
  return {
    id,
    name,
    color: PLAYER_COLORS[colorIndex % PLAYER_COLORS.length],
    role: PlayerRole.NONE,
    status: PlayerStatus.WAITING,
    x: spawn.x,
    y: spawn.y,
    angle: 0,
    catchProgress: 0,
    ripPosition: null,
  };
}

function createGameState(roomCode: string, hostId: string): GameState {
  return {
    roomCode,
    phase: GamePhase.LOBBY,
    players: [],
    hostId,
    seekerId: null,
    timeRemaining: MAP_CONFIG.gameDuration,
    marcoCooldown: 0,
    marcoRevealPlayerId: null,
    marcoRevealExpiry: null,
    winner: null,
    exploredAreas: [],
    walls: [],
  };
}


function lineIntersectsRect(p1: { x: number, y: number }, p2: { x: number, y: number }, rect: { x: number, y: number, w: number, h: number }): boolean {
  // Check minimal enclosing box first
  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);

  if (maxX < rect.x - rect.w / 2 || minX > rect.x + rect.w / 2 || maxY < rect.y - rect.h / 2 || minY > rect.y + rect.h / 2) {
    return false;
  }

  // Check intersection with each edge of the rectangle
  const rx = rect.x - rect.w / 2;
  const ry = rect.y - rect.h / 2;
  const rw = rect.w;
  const rh = rect.h;

  const left = { p1: { x: rx, y: ry }, p2: { x: rx, y: ry + rh } };
  const right = { p1: { x: rx + rw, y: ry }, p2: { x: rx + rw, y: ry + rh } };
  const top = { p1: { x: rx, y: ry }, p2: { x: rx + rw, y: ry } };
  const bottom = { p1: { x: rx, y: ry + rh }, p2: { x: rx + rw, y: ry + rh } };

  return lineIntersectsLine(p1, p2, left.p1, left.p2) ||
    lineIntersectsLine(p1, p2, right.p1, right.p2) ||
    lineIntersectsLine(p1, p2, top.p1, top.p2) ||
    lineIntersectsLine(p1, p2, bottom.p1, bottom.p2);
}

function lineIntersectsLine(a1: { x: number, y: number }, a2: { x: number, y: number }, b1: { x: number, y: number }, b2: { x: number, y: number }): boolean {
  const det = (a2.x - a1.x) * (b2.y - b1.y) - (b2.x - b1.x) * (a2.y - a1.y);
  if (det === 0) return false;

  const lambda = ((b2.y - b1.y) * (b2.x - a1.x) + (b1.x - b2.x) * (b2.y - a1.y)) / det;
  const gamma = ((a1.y - a2.y) * (b2.x - a1.x) + (a2.x - a1.x) * (b2.y - a1.y)) / det;

  return (0 <= lambda && lambda <= 1) && (0 <= gamma && gamma <= 1);
}

function isInVisionCone(
  seeker: Player,
  target: Player,
  visionAngle: number,
  visionDistance: number,
  walls: { x: number, y: number, w: number, h: number }[]
): boolean {
  const dx = target.x - seeker.x;
  const dy = target.y - seeker.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance > visionDistance) return false;

  const angleToTarget = Math.atan2(dy, dx) * (180 / Math.PI);
  let angleDiff = Math.abs(seeker.angle - angleToTarget);
  // Normalize angle difference
  while (angleDiff > 180) angleDiff -= 360;
  while (angleDiff < -180) angleDiff += 360;
  angleDiff = Math.abs(angleDiff);

  if (angleDiff > visionAngle / 2) return false;

  // Check Line of Sight against walls
  const blocked = walls.some(wall => lineIntersectsRect({ x: seeker.x, y: seeker.y }, { x: target.x, y: target.y }, wall));
  if (blocked) return false;

  return true;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents, {}, SocketData>(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    log(`Socket connected: ${socket.id}`, "socket.io");
    socket.data.roomCode = null;
    socket.data.playerId = null;
    socket.data.clientType = null;

    socket.on("createRoom", (clientType, callback) => {
      const roomCode = generateRoomCode();
      const hostId = clientType === "tv" ? socket.id : generatePlayerId();
      const gameState = createGameState(roomCode, hostId);
      rooms.set(roomCode, gameState);

      socket.data.roomCode = roomCode;
      socket.data.clientType = clientType;
      socket.join(roomCode);

      if (clientType === "tv") {
        socket.data.playerId = null;
      }

      log(`Room created: ${roomCode} by ${clientType}`, "socket.io");
      callback(roomCode);
      io.to(roomCode).emit("gameState", gameState);
    });

    socket.on("joinRoom", (roomCode, playerName, clientType, callback) => {
      const upperCode = roomCode.toUpperCase();
      const gameState = rooms.get(upperCode);

      if (!gameState) {
        callback(false, "Room not found");
        return;
      }

      if (gameState.phase !== GamePhase.LOBBY) {
        callback(false, "Game already in progress");
        return;
      }

      if (gameState.players.length >= 8) {
        callback(false, "Room is full");
        return;
      }

      if (gameState.players.some(p => p.name.toLowerCase() === playerName.toLowerCase())) {
        callback(false, "Name already taken");
        return;
      }

      if (gameState.players.some(p => p.name.toLowerCase() === playerName.toLowerCase())) {
        callback(false, "Name already taken");
        return;
      }

      socket.data.roomCode = upperCode;
      socket.data.clientType = clientType;
      socket.join(upperCode);

      if (clientType === "mobile") {
        const playerId = generatePlayerId();
        const player = createPlayer(playerId, playerName, gameState.players.length);
        gameState.players.push(player);
        socket.data.playerId = playerId;

        log(`Player ${playerName} joined room ${upperCode}`, "socket.io");
        io.to(upperCode).emit("playerJoined", player);
      } else {
        socket.data.playerId = null;
      }

      io.to(upperCode).emit("gameState", gameState);
      callback(true);
    });

    // Ready check removed


    socket.on("startGame", () => {
      const { roomCode } = socket.data;
      if (!roomCode) return;

      const gameState = rooms.get(roomCode);
      if (!gameState) return;

      if (gameState.hostId !== socket.id) {
        socket.emit("error", "Only the host can start the game");
        return;
      }

      if (gameState.players.length < 2) {
        socket.emit("error", "Need at least 2 players to start");
        return;
      }

      // Ready check removed


      const seekerIndex = Math.floor(Math.random() * gameState.players.length);
      const seekerId = gameState.players[seekerIndex].id;
      gameState.seekerId = seekerId;

      gameState.walls = generateMaze();

      gameState.players.forEach((player, index) => {
        const spawn = getRandomSpawnPosition(gameState.walls);
        player.x = spawn.x;
        player.y = spawn.y;
        player.angle = Math.random() * 360;
        player.role = player.id === seekerId ? PlayerRole.SEEKER : PlayerRole.RUNNER;
        player.status = PlayerStatus.ALIVE;
        player.catchProgress = 0;
        player.ripPosition = null;
      });

      gameState.phase = GamePhase.ROLE_REVEAL;
      gameState.timeRemaining = MAP_CONFIG.gameDuration;
      gameState.marcoCooldown = 0;
      gameState.winner = null;
      gameState.exploredAreas = [];

      io.to(roomCode).emit("gameState", gameState);
      io.to(roomCode).emit("gameStarted");

      const sockets = io.sockets.adapter.rooms.get(roomCode);
      if (sockets) {
        for (const socketId of Array.from(sockets)) {
          const clientSocket = io.sockets.sockets.get(socketId);
          if (clientSocket && clientSocket.data.playerId) {
            const player = gameState.players.find((p) => p.id === clientSocket.data.playerId);
            if (player) {
              clientSocket.emit("roleRevealed", player.role);
            }
          }
        }
      }

      setTimeout(() => {
        if (!rooms.has(roomCode)) return;
        gameState.phase = GamePhase.PLAYING;
        io.to(roomCode).emit("gameState", gameState);

        startGameLoop(roomCode, io);
      }, 3000);
    });

    socket.on("movePlayer", (x, y, angle) => {
      const { roomCode, playerId } = socket.data;
      if (!roomCode || !playerId) return;

      const gameState = rooms.get(roomCode);
      if (!gameState || gameState.phase !== GamePhase.PLAYING) return;

      const player = gameState.players.find((p) => p.id === playerId);
      if (!player || player.status !== PlayerStatus.ALIVE) return;

      // Collision check with walls
      let testRect = {
        x: x - MAP_CONFIG.playerRadius,
        y: y - MAP_CONFIG.playerRadius,
        w: MAP_CONFIG.playerRadius * 2,
        h: MAP_CONFIG.playerRadius * 2
      };

      const collision = gameState.walls.some(wall => {
        const wallRect = {
          x: wall.x - wall.w / 2,
          y: wall.y - wall.h / 2,
          w: wall.w,
          h: wall.h
        };
        return rectIntersectsRect(testRect, wallRect);
      });

      if (!collision) {
        player.x = Math.max(MAP_CONFIG.playerRadius, Math.min(MAP_CONFIG.width - MAP_CONFIG.playerRadius, x));
        player.y = Math.max(MAP_CONFIG.playerRadius, Math.min(MAP_CONFIG.height - MAP_CONFIG.playerRadius, y));
      }
      player.angle = angle;

      // Update explored areas for ALL alive players (Runners + Seeker)
      const visionRadius = player.role === PlayerRole.SEEKER
        ? MAP_CONFIG.seekerVisionDistance
        : MAP_CONFIG.runnerVisionRadius;

      gameState.exploredAreas.push({
        x: player.x,
        y: player.y,
        radius: visionRadius,
        source: player.role === PlayerRole.SEEKER ? "seeker" : "runner"
      });

      // significantly increased limit to prevent history loss
      if (gameState.exploredAreas.length > 20000) {
        gameState.exploredAreas = gameState.exploredAreas.slice(-15000);
      }
    });

    socket.on("triggerMarco", () => {
      const { roomCode, playerId } = socket.data;
      if (!roomCode || !playerId) return;

      const gameState = rooms.get(roomCode);
      if (!gameState || gameState.phase !== GamePhase.PLAYING) return;

      const player = gameState.players.find((p) => p.id === playerId);
      if (!player || player.role !== PlayerRole.SEEKER) return;

      if (gameState.marcoCooldown > 0) {
        socket.emit("error", "Marco ability is on cooldown");
        return;
      }

      const aliveRunners = gameState.players.filter(
        (p) => p.role === PlayerRole.RUNNER && p.status === PlayerStatus.ALIVE
      );

      if (aliveRunners.length === 0) return;

      const targetRunner = aliveRunners[Math.floor(Math.random() * aliveRunners.length)];
      gameState.marcoRevealPlayerId = targetRunner.id;
      gameState.marcoRevealExpiry = Date.now() + MAP_CONFIG.marcoRevealDuration;
      gameState.marcoCooldown = MAP_CONFIG.marcoCooldown;

      log(`Marco triggered! Revealing ${targetRunner.name}`, "socket.io");
      io.to(roomCode).emit("marcoTriggered", targetRunner.id);
      io.to(roomCode).emit("gameState", gameState);

      setTimeout(() => {
        if (!rooms.has(roomCode)) return;
        const gs = rooms.get(roomCode);
        if (gs) {
          gs.marcoRevealPlayerId = null;
          gs.marcoRevealExpiry = null;
          io.to(roomCode).emit("gameState", gs);
        }
      }, MAP_CONFIG.marcoRevealDuration);
    });

    socket.on("playAgain", () => {
      const { roomCode } = socket.data;
      if (!roomCode) return;

      const gameState = rooms.get(roomCode);
      if (!gameState) return;

      // Reset game state to LOBBY
      gameState.phase = GamePhase.LOBBY;
      gameState.winner = null;
      gameState.seekerId = null;
      gameState.timeRemaining = MAP_CONFIG.gameDuration;
      gameState.marcoCooldown = 0;
      gameState.marcoRevealPlayerId = null;
      gameState.exploredAreas = [];

      // Reset players
      gameState.players.forEach(p => {
        p.role = PlayerRole.NONE;
        p.status = PlayerStatus.WAITING;
        p.catchProgress = 0;
        p.ripPosition = null;
        p.angle = 0;
        // Reset position to a random spawn ? Or keep them where they were?
        // Better to respawn them when game starts, so just leave x/y for now or reset providing visual feedback?
        // Let's leave x/y as is, they will be teleported on game start.
      });

      log(`Game reset in room ${roomCode}`, "socket.io");
      io.to(roomCode).emit("gameState", gameState);
    });

    socket.on("leaveRoom", () => {
      handlePlayerLeave(socket, io);
    });

    socket.on("disconnect", () => {
      log(`Socket disconnected: ${socket.id}`, "socket.io");
      handlePlayerLeave(socket, io);
    });
  });

  function handlePlayerLeave(
    socket: any,
    io: SocketIOServer<ClientToServerEvents, ServerToClientEvents, {}, SocketData>
  ) {
    const { roomCode, playerId, clientType } = socket.data;
    if (!roomCode) return;

    const gameState = rooms.get(roomCode);
    if (!gameState) return;

    if (clientType === "mobile" && playerId) {
      gameState.players = gameState.players.filter((p) => p.id !== playerId);
      io.to(roomCode).emit("playerLeft", playerId);
      io.to(roomCode).emit("gameState", gameState);
      log(`Player ${playerId} left room ${roomCode}`, "socket.io");
    }

    if (clientType === "tv" || gameState.players.length === 0) {
      const interval = gameIntervals.get(roomCode);
      if (interval) {
        clearInterval(interval);
        gameIntervals.delete(roomCode);
      }
      rooms.delete(roomCode);
      log(`Room ${roomCode} closed`, "socket.io");
    }

    socket.leave(roomCode);
    socket.data.roomCode = null;
    socket.data.playerId = null;
    socket.data.clientType = null;
  }

  function startGameLoop(
    roomCode: string,
    io: SocketIOServer<ClientToServerEvents, ServerToClientEvents, {}, SocketData>
  ) {
    const tickRate = 30; // Faster updates (approx 33ms)
    let lastTick = Date.now();

    const interval = setInterval(() => {
      const gameState = rooms.get(roomCode);
      if (!gameState || gameState.phase !== GamePhase.PLAYING) {
        clearInterval(interval);
        gameIntervals.delete(roomCode);
        return;
      }

      const now = Date.now();
      const delta = now - lastTick;
      lastTick = now;

      gameState.timeRemaining = Math.max(0, gameState.timeRemaining - delta);
      gameState.marcoCooldown = Math.max(0, gameState.marcoCooldown - delta);

      const seeker = gameState.players.find((p) => p.role === PlayerRole.SEEKER);
      if (seeker && seeker.status === PlayerStatus.ALIVE) {
        gameState.players.forEach((runner) => {
          if (runner.role !== PlayerRole.RUNNER || runner.status !== PlayerStatus.ALIVE) return;

          const inVision = isInVisionCone(
            seeker,
            runner,
            MAP_CONFIG.seekerVisionAngle,
            MAP_CONFIG.seekerVisionDistance,
            gameState.walls
          );

          if (inVision) {
            runner.catchProgress += (delta / MAP_CONFIG.catchDuration) * 100;
            if (runner.catchProgress >= 100) {
              runner.status = PlayerStatus.CAUGHT;
              runner.ripPosition = { x: runner.x, y: runner.y };
              runner.catchProgress = 100;
              io.to(roomCode).emit("playerCaught", runner.id, { x: runner.x, y: runner.y });
              log(`Player ${runner.name} was caught!`, "socket.io");
            }
          } else {
            runner.catchProgress = Math.max(0, runner.catchProgress - (delta / 500) * 100);
          }
        });
      }

      const aliveRunners = gameState.players.filter(
        (p) => p.role === PlayerRole.RUNNER && p.status === PlayerStatus.ALIVE
      );

      if (aliveRunners.length === 0) {
        endGame(roomCode, "seeker", io);
        return;
      }

      if (gameState.timeRemaining <= 0) {
        endGame(roomCode, "runners", io);
        return;
      }

      io.to(roomCode).emit("gameState", gameState);
    }, tickRate);

    gameIntervals.set(roomCode, interval);
  }

  function endGame(
    roomCode: string,
    winner: "seeker" | "runners",
    io: SocketIOServer<ClientToServerEvents, ServerToClientEvents, {}, SocketData>
  ) {
    const gameState = rooms.get(roomCode);
    if (!gameState) return;

    gameState.phase = GamePhase.GAME_OVER;
    gameState.winner = winner;

    const interval = gameIntervals.get(roomCode);
    if (interval) {
      clearInterval(interval);
      gameIntervals.delete(roomCode);
    }

    log(`Game over in room ${roomCode}. Winner: ${winner}`, "socket.io");
    io.to(roomCode).emit("gameOver", winner);
    io.to(roomCode).emit("gameState", gameState);
  }

  return httpServer;
}
