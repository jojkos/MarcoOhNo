// Adaptive soundtrack, generated live with Tone.js (no audio files).
// Modes: lobby (chill synthwave), tension (reveal/scatter), hunt (layers driven by
// intensity, faster in the last 30s), silence.
import type * as ToneTypes from "tone";
import { audioSettings, useAudioPrefs } from "./settings";

export type MusicMode = "off" | "lobby" | "tension" | "hunt";

const LOBBY_CHORDS = [
  ["A3", "C4", "E4"],
  ["F3", "A3", "C4"],
  ["C4", "E4", "G4"],
  ["G3", "B3", "D4"],
];
const LOBBY_BASS = ["A1", "F1", "C2", "G1"];
const HUNT_CHORDS = [
  ["D3", "F3", "A3"],
  ["A#2", "D3", "F3"],
  ["G2", "A#2", "D3"],
  ["A2", "C#3", "E3"],
];
const HUNT_BASS = ["D1", "A#0", "G0", "A0"];
const HUNT_RIFF = [0, 0, 12, 0, 0, 3, 0, 7, 0, 0, 12, 0, 10, 0, 7, 5];

// Loaded on the first user gesture: importing Tone creates an AudioContext.
let Tone: typeof import("tone");
let started = false;
let mode: MusicMode = "off";
let intensity = 0;
let step = 0;
let lastBpmTarget = 92;

let nodes: {
  master: ToneTypes.Volume;
  pad: ToneTypes.PolySynth;
  padFilter: ToneTypes.Filter;
  bass: ToneTypes.MonoSynth;
  arp: ToneTypes.Synth;
  kick: ToneTypes.MembraneSynth;
  snare: ToneTypes.NoiseSynth;
  hat: ToneTypes.MetalSynth;
  drone: ToneTypes.Oscillator;
  droneGain: ToneTypes.Gain;
  loop: ToneTypes.Loop;
} | null = null;

function build() {
  const master = new Tone.Volume(-8).toDestination();
  const reverb = new Tone.Reverb({ decay: 5, wet: 0.32 }).connect(master);
  const delay = new Tone.FeedbackDelay({ delayTime: "8n.", feedback: 0.32, wet: 0.25 }).connect(reverb);

  const padFilter = new Tone.Filter(1400, "lowpass").connect(reverb);
  const pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "fatsawtooth", count: 3, spread: 28 },
    envelope: { attack: 0.8, decay: 0.4, sustain: 0.6, release: 2.2 },
    volume: -20,
  }).connect(padFilter);

  const bass = new Tone.MonoSynth({
    oscillator: { type: "sawtooth" },
    filter: { Q: 2, type: "lowpass" },
    filterEnvelope: { attack: 0.005, decay: 0.15, sustain: 0.2, baseFrequency: 120, octaves: 2.6 },
    envelope: { attack: 0.005, decay: 0.2, sustain: 0.4, release: 0.2 },
    volume: -12,
  }).connect(master);

  const arp = new Tone.Synth({
    oscillator: { type: "square" },
    envelope: { attack: 0.002, decay: 0.12, sustain: 0, release: 0.1 },
    volume: -24,
  }).connect(delay);

  const kick = new Tone.MembraneSynth({ pitchDecay: 0.03, octaves: 6, envelope: { attack: 0.001, decay: 0.35, sustain: 0 }, volume: -8 }).connect(master);
  const snare = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.16, sustain: 0 }, volume: -20 }).connect(reverb);
  const hat = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.05, release: 0.01 }, harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5, volume: -32 }).connect(master);
  hat.frequency.value = 250;

  const droneGain = new Tone.Gain(0).connect(reverb);
  const drone = new Tone.Oscillator({ frequency: "D1", type: "sawtooth" }).connect(new Tone.Filter(220, "lowpass").connect(droneGain));
  drone.start();

  const loop = new Tone.Loop((time) => tick(time), "16n").start(0);
  nodes = { master, pad, padFilter, bass, arp, kick, snare, hat, drone, droneGain, loop };
  applyVolume();
}

function applyVolume() {
  if (!nodes) return;
  const v = audioSettings.get().music;
  nodes.master.volume.rampTo(v <= 0.001 ? -Infinity : -8 + 20 * Math.log10(v), 0.3);
}

useAudioPrefs.subscribe(applyVolume);

function tick(time: number) {
  if (!nodes) return;
  const s = step++ % 16;
  const bar = Math.floor((step - 1) / 16) % 4;
  const n = nodes;

  if (mode === "lobby") {
    if (s === 0) n.pad.triggerAttackRelease(LOBBY_CHORDS[bar], "1m", time, 0.6);
    if (s === 0 || s === 10) n.bass.triggerAttackRelease(LOBBY_BASS[bar], "8n", time, 0.6);
    if (s % 2 === 0) {
      const chord = LOBBY_CHORDS[bar];
      const note = Tone.Frequency(chord[(s / 2) % 3]).transpose(12 + (s >= 8 ? 12 : 0));
      n.arp.triggerAttackRelease(note.toFrequency(), "32n", time, 0.35);
    }
    if (s === 0 || s === 8) n.kick.triggerAttackRelease("C1", "8n", time, 0.5);
    if (s === 4 || s === 12) n.hat.triggerAttackRelease("32n", time, 0.3);
  } else if (mode === "tension") {
    if (s % 4 === 0) n.hat.triggerAttackRelease("32n", time, s === 0 ? 0.6 : 0.3);
    if (s === 0 && bar % 2 === 0) n.bass.triggerAttackRelease("D1", "2n", time, 0.5);
  } else if (mode === "hunt") {
    const k = intensity;
    if (s === 0) n.pad.triggerAttackRelease(HUNT_CHORDS[bar], "1m", time, 0.35 + k * 0.3);
    const root = Tone.Frequency(HUNT_BASS[bar]).transpose(12);
    const pulse = k > 0.55 ? true : s % 2 === 0;
    if (pulse) n.bass.triggerAttackRelease(root.transpose(HUNT_RIFF[s] * (k > 0.4 ? 1 : 0)).toFrequency(), "16n", time, s % 4 === 0 ? 0.9 : 0.55);
    if (k > 0.25 && s % 4 === 0) n.kick.triggerAttackRelease("C1", "8n", time, 0.85);
    if (k > 0.55 && (s === 4 || s === 12)) n.snare.triggerAttackRelease("16n", time, 0.8);
    if (k > 0.7 || (k > 0.35 && s % 2 === 1)) n.hat.triggerAttackRelease("32n", time, s % 4 === 2 ? 0.5 : 0.25);
    if (k > 0.5 && s % 2 === 0) {
      const chord = HUNT_CHORDS[bar];
      const note = Tone.Frequency(chord[(s / 2) % 3]).transpose(24);
      n.arp.triggerAttackRelease(note.toFrequency(), "32n", time, 0.3 + k * 0.2);
    }
  }
}

/** Must be called from a user gesture at least once. */
export async function startMusic() {
  if (started) return;
  started = true;
  Tone = await import("tone");
  await Tone.start();
  build();
  Tone.getTransport().bpm.value = 92;
  Tone.getTransport().start("+0.1");
}

export function setMusic(next: MusicMode, nextIntensity = 0, finalStretch = false) {
  intensity = Math.max(0, Math.min(1, nextIntensity));
  if (!nodes) {
    mode = next;
    return;
  }
  const bpm = Tone.getTransport().bpm;
  if (next !== mode) {
    mode = next;
    step = 0;
    nodes.pad.releaseAll();
  }
  const targetBpm = Math.round(mode === "lobby" ? 92 : mode === "hunt" ? (finalStretch ? 134 : 108 + intensity * 10) : 100);
  // Called ~10x a second: only start a ramp when the target changes, or it never finishes.
  if (targetBpm !== lastBpmTarget) {
    lastBpmTarget = targetBpm;
    bpm.rampTo(targetBpm, finalStretch ? 1 : 2);
  }
  nodes.padFilter.frequency.rampTo(mode === "hunt" ? 500 + intensity * 2200 : 1400, 1);
  nodes.droneGain.gain.rampTo(mode === "tension" ? 0.08 : mode === "hunt" ? 0.03 + intensity * 0.04 : 0, 1);
}

export function stopMusic() {
  setMusic("off");
}
