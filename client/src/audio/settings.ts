// Per-device audio preferences, persisted locally.
import { create } from "zustand";

export interface AudioPrefs {
  music: number; // 0..1
  sfx: number; // 0..1
  haptics: boolean;
}

const KEY = "mon.audio";
const isPhone = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
// Phones play only their own sounds by default; the TV plays the soundtrack.
const DEFAULTS: AudioPrefs = { music: isPhone ? 0 : 0.7, sfx: 0.9, haptics: true };

function load(): AudioPrefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

export const useAudioPrefs = create<AudioPrefs>(() => load());

export const audioSettings = {
  get: () => useAudioPrefs.getState(),
  set(patch: Partial<AudioPrefs>) {
    useAudioPrefs.setState(patch);
    try {
      localStorage.setItem(KEY, JSON.stringify(useAudioPrefs.getState()));
    } catch {
      /* private mode */
    }
  },
};
