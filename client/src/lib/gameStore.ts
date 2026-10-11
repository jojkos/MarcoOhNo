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

export type AttachMode = "tv" | "play";

/** Which room this tab is following, and how that's going. */
export interface Attachment {
  mode: AttachMode;
  code: string;
  status: "connecting" | "attached" | "error";
  /** TV screens that own the host token can start rounds; others just watch. */
  isHost: boolean;
  error?: { reason: string; message: string };
}

interface GameStore {
  connected: boolean;
  attachment: Attachment | null;
  playerId: string | null;
  room: RoomInfo | null;
  hud: Hud | null;
}

export const useGameStore = create<GameStore>(() => ({
  connected: false,
  attachment: null,
  playerId: null,
  room: null,
  hud: null,
}));
