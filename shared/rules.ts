import { ABILITIES, PLAYER } from "./config";
import type { Phase, Role, Status } from "./schema";

export type Ability = "polo" | "sprint" | "dash" | "boo" | "help";

/** Which ability sits on which button. */
export function abilityFor(role: Role, status: Status, slot: "a" | "b"): Ability | null {
  if (role === "seeker") return slot === "a" ? "polo" : "sprint";
  if (status === "ghost") return slot === "a" ? "boo" : null;
  if (status === "caged") return slot === "a" ? "help" : null;
  return slot === "a" ? "dash" : null;
}

export function abilityAllowed(ability: Ability, phase: Phase): boolean {
  if (ability === "dash") return phase === "scatter" || phase === "hunt";
  return phase === "hunt";
}

export function abilityCooldown(ability: Ability): number {
  switch (ability) {
    case "polo":
      return ABILITIES.polo.cooldownMs;
    case "sprint":
      return ABILITIES.sprint.cooldownMs;
    case "dash":
      return ABILITIES.dash.cooldownMs;
    case "boo":
      return ABILITIES.boo.cooldownMs;
    case "help":
      return 6000;
  }
}

export function baseSpeed(role: Role, status: Status): number {
  if (role === "seeker") return PLAYER.seekerSpeed;
  return status === "ghost" ? PLAYER.ghostSpeed : PLAYER.runnerSpeed;
}

export interface FreezeInput {
  role: Role;
  status: Status;
  locker: number;
  rooted: boolean;
  searching: number;
}

/** Whether a player may move right now. */
export function isFrozen(p: FreezeInput, phase: Phase): boolean {
  if (phase === "lobby" || phase === "reveal" || phase === "round_over") return true;
  if (phase === "scatter" && p.role === "seeker") return true;
  if (p.status === "caged") return true;
  return p.locker >= 0 || p.rooted || p.searching > 0;
}
