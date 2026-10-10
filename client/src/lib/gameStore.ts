import { create } from "zustand";
import type { Phase, RoomInfo, SnapPlayer } from "@shared/protocol";

/** Slow-changing HUD data, refreshed from snapshots ~10x per second. */
export interface Hud {
  phase: Phase;
  phaseLeft: number;
  collected: number;
  players: SnapPlayer[];
  me: SnapPlayer | null;
  /** Some runner is close to being caught (drives the TV's red pulse). */
  danger: boolean;
  /** 0..1 how close the seeker is to me (runners only). */
  threat: number;
}

export type ClientKind = "tv" | "mobile";

interface GameStore {
  connected: boolean;
  kind: ClientKind | null;
  playerId: string | null;
  room: RoomInfo | null;
  hud: Hud | null;
  /** True while trying to reattach to a saved session after load/reconnect. */
  resuming: boolean;
}

export const useGameStore = create<GameStore>(() => ({
  connected: false,
  kind: null,
  playerId: null,
  room: null,
  hud: null,
  resuming: false,
}));

export function myLobbyPlayer() {
  const { room, playerId } = useGameStore.getState();
  return room?.players.find((p) => p.id === playerId) ?? null;
}
