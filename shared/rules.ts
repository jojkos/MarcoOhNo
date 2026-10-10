import type { Phase, Role, Status, Wall } from "./protocol";
import { ABILITIES, PLAYER } from "./config";
import type { MoveCtx } from "./physics";

export type Ability = "polo" | "sprint" | "dash" | "boo";

/** Which ability sits in which button for a given player. */
export function abilityFor(role: Role, status: Status, slot: "a" | "b"): Ability | null {
  if (role === "seeker") return slot === "a" ? "polo" : "sprint";
  if (status === "ghost") return slot === "a" ? "boo" : null;
  if (status === "free") return slot === "a" ? "dash" : null;
  return null;
}

export function abilityAllowed(ability: Ability, phase: Phase): boolean {
  if (ability === "dash") return phase === "scatter" || phase === "hunt";
  return phase === "hunt";
}

export function abilityCooldown(ability: Ability): number {
  return ABILITIES[ability].cooldownMs;
}

/** Movement boost granted by an ability, if any. */
export function abilityBoost(ability: Ability): { steps: number; mul: number } | null {
  if (ability === "dash") return { steps: ABILITIES.dash.steps, mul: ABILITIES.dash.multiplier };
  if (ability === "sprint") return { steps: ABILITIES.sprint.steps, mul: ABILITIES.sprint.multiplier };
  return null;
}

export function isFrozen(role: Role, status: Status, phase: Phase): boolean {
  if (phase === "reveal" || phase === "round_over" || phase === "lobby") return true;
  if (phase === "scatter" && role === "seeker") return true;
  return status === "caged";
}

export function moveCtxFor(
  role: Role,
  status: Status,
  phase: Phase,
  map: { walls: Wall[]; width: number; height: number },
): MoveCtx {
  const ghost = status === "ghost";
  return {
    walls: map.walls,
    width: map.width,
    height: map.height,
    ghost,
    frozen: isFrozen(role, status, phase),
    speed: role === "seeker" ? PLAYER.seekerSpeed : ghost ? PLAYER.ghostSpeed : PLAYER.runnerSpeed,
    turnRate: role === "seeker" ? PLAYER.seekerTurnRate : Infinity,
  };
}
