import { useEffect } from "react";

/** Keep the phone awake while in a room; a sleeping phone drops its connection. */
export function useWakeLock() {
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null;
    const request = () => {
      (navigator as any).wakeLock
        ?.request("screen")
        .then((l: typeof lock) => (lock = l))
        .catch(() => {});
    };
    request();
    const onVisible = () => document.visibilityState === "visible" && request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release().catch(() => {});
    };
  }, []);
}
