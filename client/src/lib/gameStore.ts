import { create } from "zustand";
import type { Phase, Role, Status } from "@shared/schema";
import type { RoundResult } from "@shared/protocol";

/** Plain-object copy of a synced player, for React. */
export interface PlayerView {
  id: string;
  name: string;
  color: string;
  face: number;
  isBot: boolean;
  connected: boolean;
  score: number;
  inRound: boolean;
  role: Role;
  status: Status;
  exposure: number;
  rescue: number;
  invuln: boolean;
  locker: number;
  rooted: boolean;
  blinded: boolean;
  searching: number;
  cdA: number;
  cdB: number;
  item: string;
  x: number;
  y: number;
}

/** What React renders: refreshed ~10x/s from the synced state (immediately on phase changes). */
export interface RoomView {
  code: string;
  phase: Phase;
  phaseLeft: number;
  vipId: string;
  hostConnected: boolean;
  collected: number;
  players: PlayerView[];
  round: { id: number; seekerId: string; orbsToWin: number } | null;
  result: RoundResult | null;
  /** Some runner is close to being caught (TV's red pulse). */
  danger: boolean;
}

export type AttachMode = "tv" | "play";

export interface Attachment {
  mode: AttachMode;
  code: string;
  status: "connecting" | "attached" | "reconnecting" | "error";
  /** TV screens holding the host token control the room; others only watch. */
  isHost: boolean;
  error?: { reason: string; message: string };
}

interface GameStore {
  attachment: Attachment | null;
  playerId: string | null;
  view: RoomView | null;
}

export const useGameStore = create<GameStore>(() => ({ attachment: null, playerId: null, view: null }));

export function useMe(): PlayerView | null {
  return useGameStore((s) => s.view?.players.find((p) => p.id === s.playerId) ?? null);
}
