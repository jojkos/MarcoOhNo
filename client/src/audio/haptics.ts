// Vibration (Android; iOS Safari ignores it). Respects the user's setting.
import { audioSettings } from "./settings";

function vibrate(pattern: number | number[]) {
  if (!audioSettings.get().haptics) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}

export const haptic = {
  tap: () => vibrate(8),
  bump: () => vibrate(25),
  heartbeat: (k: number) => vibrate(Math.round(18 + 40 * k)),
  caught: () => vibrate([350, 80, 350]),
  freed: () => vibrate([50, 40, 50, 40, 90]),
  alert: () => vibrate([70, 50, 70]),
  go: () => vibrate(180),
};
