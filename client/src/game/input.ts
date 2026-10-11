// Shared input state. The on-screen joystick/buttons and the keyboard write here;
// the game reads it every frame.
import type { ActionSlot } from "@shared/protocol";

export const input = {
  /** Joystick vector, magnitude 0..1. */
  joyX: 0,
  joyY: 0,
  /** One-shot button presses, consumed by the next frame. */
  presses: new Set<ActionSlot>(),
};

const keys = new Set<string>();
const KEY_ACTIONS: Record<string, ActionSlot> = {
  Space: "a",
  ShiftLeft: "b",
  ShiftRight: "b",
  KeyQ: "item",
  KeyE: "act",
};

if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement)?.tagName === "INPUT") return;
    keys.add(e.code);
    const slot = KEY_ACTIONS[e.code];
    if (slot && !e.repeat) {
      input.presses.add(slot);
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", () => keys.clear());
}

export function press(slot: ActionSlot) {
  input.presses.add(slot);
}

/** Movement vector from the joystick, or the keyboard (desktop testing). */
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

export function takePresses(): ActionSlot[] {
  const list = [...input.presses];
  input.presses.clear();
  return list;
}
