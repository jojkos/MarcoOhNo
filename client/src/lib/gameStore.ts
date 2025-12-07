import { create } from "zustand";
import type { GameState, Player, ClientType, PlayerRole } from "@shared/schema";

interface GameStore {
  connected: boolean;
  setConnected: (connected: boolean) => void;
  
  clientType: ClientType | null;
  setClientType: (type: ClientType) => void;
  
  playerId: string | null;
  setPlayerId: (id: string | null) => void;
  
  playerName: string;
  setPlayerName: (name: string) => void;
  
  roomCode: string | null;
  setRoomCode: (code: string | null) => void;
  
  gameState: GameState | null;
  setGameState: (state: GameState | null) => void;
  
  revealedRole: PlayerRole | null;
  setRevealedRole: (role: PlayerRole | null) => void;
  
  error: string | null;
  setError: (error: string | null) => void;
  
  getPlayer: () => Player | null;
  isHost: () => boolean;
  isSeeker: () => boolean;
  
  reset: () => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  connected: false,
  setConnected: (connected) => set({ connected }),
  
  clientType: null,
  setClientType: (clientType) => set({ clientType }),
  
  playerId: null,
  setPlayerId: (playerId) => set({ playerId }),
  
  playerName: "",
  setPlayerName: (playerName) => set({ playerName }),
  
  roomCode: null,
  setRoomCode: (roomCode) => set({ roomCode }),
  
  gameState: null,
  setGameState: (gameState) => set({ gameState }),
  
  revealedRole: null,
  setRevealedRole: (revealedRole) => set({ revealedRole }),
  
  error: null,
  setError: (error) => set({ error }),
  
  getPlayer: () => {
    const { gameState, playerId } = get();
    if (!gameState || !playerId) return null;
    return gameState.players.find((p) => p.id === playerId) || null;
  },
  
  isHost: () => {
    const { gameState, playerId } = get();
    return gameState?.hostId === playerId;
  },
  
  isSeeker: () => {
    const player = get().getPlayer();
    return player?.role === "seeker";
  },
  
  reset: () => set({
    roomCode: null,
    gameState: null,
    revealedRole: null,
    error: null,
    playerId: null,
  }),
}));
