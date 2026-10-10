// Shared mutable input state. The on-screen joystick/buttons and the keyboard
// write here; the game scene reads it once per simulation step.

export const input = {
  /** Joystick vector, magnitude 0..1. */
  joyX: 0,
  joyY: 0,
  /** One-shot ability presses, consumed by the next simulation step. */
  pressA: false,
  pressB: false,
};

const keys = new Set<string>();

if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement)?.tagName === "INPUT") return;
    keys.add(e.code);
    if (e.code === "Space" && !e.repeat) input.pressA = true;
    if ((e.code === "ShiftLeft" || e.code === "ShiftRight") && !e.repeat) input.pressB = true;
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", () => keys.clear());
}

/** Current movement vector from joystick, or keyboard as a fallback (desktop testing). */
export function readMove(): { mx: number; my: number } {
  if (input.joyX !== 0 || input.joyY !== 0) return { mx: input.joyX, my: input.joyY };
  let mx = 0;
  let my = 0;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) mx -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) mx += 1;
  if (keys.has("KeyW") || keys.has("ArrowUp")) my -= 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) my += 1;
  const len = Math.hypot(mx, my);
  return len ? { mx: mx / len, my: my / len } : { mx: 0, my: 0 };
}

export function consumePresses(): { a: boolean; b: boolean } {
  const res = { a: input.pressA, b: input.pressB };
  input.pressA = false;
  input.pressB = false;
  return res;
}
