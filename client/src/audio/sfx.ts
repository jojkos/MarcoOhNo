// Sound effects, synthesised into AudioBuffers once and replayed (no files to load).
import { audioSettings } from "./settings";

type Shape = "sine" | "square" | "saw" | "tri" | "noise";

interface Layer {
  shape: Shape;
  freq: number;
  /** End frequency (exponential slide). */
  to?: number;
  dur: number;
  delay?: number;
  attack?: number;
  release?: number;
  vol?: number;
  /** Semitone steps played in sequence (arpeggio). */
  steps?: number[];
  vibrato?: [rate: number, depth: number];
  /** One-pole low-pass cutoff (Hz). */
  lowpass?: number;
  /** Mix of white noise into a tone (0..1). */
  grit?: number;
}

const SR = 44100;
let ctx: AudioContext | null = null;
let out: GainNode | null = null;
const buffers = new Map<string, AudioBuffer>();

/** Created lazily, and only from a user gesture (see unlockAudio). */
function audio(create = false): AudioContext | null {
  if (!ctx && create) {
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    out = ctx.createGain();
    out.connect(ctx.destination);
  }
  return ctx;
}

/** Browsers only allow audio after a user gesture. */
export function unlockAudio() {
  const ac = audio(true);
  if (ac?.state === "suspended") ac.resume().catch(() => {});
}
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", unlockAudio, { passive: true });
  window.addEventListener("keydown", unlockAudio);
}

function render(layers: Layer[]): AudioBuffer {
  const ac = audio()!;
  const len = Math.ceil(SR * Math.max(...layers.map((l) => (l.delay ?? 0) + l.dur + (l.release ?? 0.05))));
  const buf = ac.createBuffer(1, len, SR);
  const data = buf.getChannelData(0);
  for (const l of layers) {
    const start = Math.floor((l.delay ?? 0) * SR);
    const n = Math.floor((l.dur + (l.release ?? 0.05)) * SR);
    const attack = Math.max(1, (l.attack ?? 0.005) * SR);
    const sustainEnd = l.dur * SR;
    const release = Math.max(1, (l.release ?? 0.05) * SR);
    const vol = l.vol ?? 0.4;
    let phase = 0;
    let lp = 0;
    const alpha = l.lowpass ? 1 - Math.exp((-2 * Math.PI * l.lowpass) / SR) : 1;
    for (let i = 0; i < n && start + i < len; i++) {
      const t = i / SR;
      const k = Math.min(1, i / sustainEnd);
      let f = l.to ? l.freq * Math.pow(l.to / l.freq, k) : l.freq;
      if (l.steps) f *= Math.pow(2, l.steps[Math.min(l.steps.length - 1, Math.floor((k * l.steps.length) % l.steps.length))] / 12);
      if (l.vibrato) f *= 1 + Math.sin(t * 2 * Math.PI * l.vibrato[0]) * l.vibrato[1];
      phase += f / SR;
      const p = phase % 1;
      let v: number;
      switch (l.shape) {
        case "sine":
          v = Math.sin(p * 2 * Math.PI);
          break;
        case "square":
          v = p < 0.5 ? 0.6 : -0.6;
          break;
        case "saw":
          v = (p * 2 - 1) * 0.7;
          break;
        case "tri":
          v = 1 - 4 * Math.abs(p - 0.5);
          break;
        default:
          v = Math.random() * 2 - 1;
      }
      if (l.grit) v = v * (1 - l.grit) + (Math.random() * 2 - 1) * l.grit;
      lp += (v - lp) * alpha;
      const env = i < attack ? i / attack : i < sustainEnd ? 1 : Math.exp(-((i - sustainEnd) / release) * 4);
      data[start + i] += lp * env * vol;
    }
  }
  return buf;
}

const BANK: Record<string, Layer[]> = {
  tap: [{ shape: "sine", freq: 900, to: 1200, dur: 0.03, vol: 0.18 }],
  join: [{ shape: "tri", freq: 523, dur: 0.18, steps: [0, 7, 12], vol: 0.35 }],
  tick: [{ shape: "square", freq: 1400, dur: 0.02, vol: 0.12, lowpass: 5000 }],
  go: [
    { shape: "saw", freq: 220, to: 880, dur: 0.35, vol: 0.25, lowpass: 3000 },
    { shape: "noise", freq: 0, dur: 0.3, vol: 0.12, lowpass: 2500 },
  ],
  marco: [
    { shape: "square", freq: 392, dur: 0.2, vol: 0.22, lowpass: 2500, vibrato: [6, 0.01] },
    { shape: "square", freq: 523, dur: 0.32, delay: 0.24, vol: 0.22, lowpass: 2500, vibrato: [6, 0.015] },
  ],
  polo: [
    { shape: "tri", freq: 523, dur: 0.17, vol: 0.4 },
    { shape: "tri", freq: 392, dur: 0.28, delay: 0.2, vol: 0.4 },
  ],
  noise: [{ shape: "sine", freq: 150, to: 70, dur: 0.18, vol: 0.5, release: 0.15 }],
  creak: [{ shape: "saw", freq: 180, to: 95, dur: 0.45, vol: 0.18, lowpass: 900, vibrato: [22, 0.06], grit: 0.25 }],
  sneeze: [
    { shape: "noise", freq: 0, dur: 0.05, vol: 0.25, lowpass: 3000 },
    { shape: "saw", freq: 600, to: 260, dur: 0.22, delay: 0.06, vol: 0.18, lowpass: 2500, grit: 0.4 },
  ],
  orb: [{ shape: "sine", freq: 880, dur: 0.32, steps: [0, 4, 7, 12], vol: 0.3, release: 0.25 }],
  item: [{ shape: "tri", freq: 660, to: 1760, dur: 0.25, vol: 0.25, vibrato: [18, 0.02] }],
  dash: [{ shape: "noise", freq: 0, dur: 0.18, vol: 0.35, lowpass: 1800, release: 0.12 }],
  sprint: [{ shape: "saw", freq: 110, to: 330, dur: 0.4, vol: 0.18, lowpass: 1200 }],
  caught: [
    { shape: "sine", freq: 160, to: 40, dur: 0.5, vol: 0.7, release: 0.3 },
    { shape: "noise", freq: 0, dur: 0.35, vol: 0.4, lowpass: 2200, release: 0.3 },
    { shape: "saw", freq: 220, to: 110, dur: 0.3, vol: 0.15, lowpass: 1500 },
  ],
  ghost: [{ shape: "sine", freq: 600, to: 200, dur: 0.9, vol: 0.25, vibrato: [7, 0.06], release: 0.4 }],
  freed: [{ shape: "tri", freq: 523, dur: 0.4, steps: [0, 4, 7, 12, 16], vol: 0.3, release: 0.2 }],
  boo: [{ shape: "saw", freq: 140, to: 90, dur: 0.6, vol: 0.2, lowpass: 600, vibrato: [5, 0.08] }],
  smoke: [{ shape: "noise", freq: 0, dur: 0.9, vol: 0.25, lowpass: 900, attack: 0.05, release: 0.5 }],
  flash: [
    { shape: "noise", freq: 0, dur: 0.08, vol: 0.5, lowpass: 9000 },
    { shape: "sine", freq: 3200, to: 1200, dur: 0.6, vol: 0.12, release: 0.4 },
  ],
  flare: [{ shape: "noise", freq: 0, dur: 0.6, vol: 0.2, lowpass: 4000, attack: 0.02, grit: 0.2 }],
  trapSet: [{ shape: "square", freq: 300, dur: 0.04, vol: 0.2, lowpass: 2000 }],
  trapped: [
    { shape: "square", freq: 900, to: 300, dur: 0.08, vol: 0.3, lowpass: 3000 },
    { shape: "noise", freq: 0, dur: 0.1, vol: 0.3, lowpass: 5000 },
  ],
  decoy: [{ shape: "sine", freq: 500, dur: 0.3, vol: 0.2, vibrato: [14, 0.08] }],
  pop: [{ shape: "sine", freq: 700, to: 180, dur: 0.12, vol: 0.4 }],
  door: [{ shape: "sine", freq: 120, to: 70, dur: 0.12, vol: 0.5, grit: 0.15 }],
  search: [{ shape: "noise", freq: 0, dur: 0.5, vol: 0.15, lowpass: 1200, vibrato: [9, 0.3] }],
  found: [
    { shape: "square", freq: 880, dur: 0.12, vol: 0.25, lowpass: 3000 },
    { shape: "square", freq: 660, dur: 0.12, delay: 0.14, vol: 0.25, lowpass: 3000 },
    { shape: "square", freq: 880, dur: 0.2, delay: 0.28, vol: 0.25, lowpass: 3000 },
  ],
  empty: [{ shape: "sine", freq: 180, to: 140, dur: 0.15, vol: 0.35, grit: 0.1 }],
  help: [
    { shape: "square", freq: 1046, dur: 0.1, vol: 0.18, lowpass: 3000 },
    { shape: "square", freq: 1046, dur: 0.1, delay: 0.18, vol: 0.18, lowpass: 3000 },
  ],
  win: [{ shape: "tri", freq: 523, dur: 0.9, steps: [0, 4, 7, 12, 16, 19, 24], vol: 0.3, release: 0.4 }],
  lose: [{ shape: "saw", freq: 392, dur: 1.0, steps: [0, -1, -3, -5], vol: 0.18, lowpass: 1400, vibrato: [5, 0.01], release: 0.3 }],
  heartbeat: [
    { shape: "sine", freq: 62, to: 45, dur: 0.1, vol: 0.9 },
    { shape: "sine", freq: 55, to: 40, dur: 0.12, delay: 0.16, vol: 0.7 },
  ],
  step: [{ shape: "noise", freq: 0, dur: 0.025, vol: 0.06, lowpass: 900 }],
};

export type SfxName = keyof typeof BANK;

export function playSfx(name: SfxName, opts: { pan?: number; gain?: number; rate?: number } = {}) {
  const ac = audio();
  const vol = audioSettings.get().sfx;
  if (!ac || !out || ac.state !== "running" || vol <= 0) return;
  let buf = buffers.get(name);
  if (!buf) {
    buf = render(BANK[name]);
    buffers.set(name, buf);
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = opts.rate ?? 1;
  const g = ac.createGain();
  g.gain.value = vol * (opts.gain ?? 1);
  let node: AudioNode = src.connect(g);
  if (opts.pan && ac.createStereoPanner) {
    const p = ac.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, opts.pan));
    node = node.connect(p);
  }
  node.connect(out);
  src.start();
}

/** Pre-render the bank in idle time so the first play has no hitch. */
export function warmSfx() {
  const ac = audio(true);
  if (!ac) return;
  const names = Object.keys(BANK).filter((n) => !buffers.has(n));
  const next = () => {
    const n = names.shift();
    if (!n) return;
    buffers.set(n, render(BANK[n]));
    setTimeout(next, 0);
  };
  next();
}

/** Rising whine while a runner is lit. Call with 0..1 every frame. */
let whine: { osc: OscillatorNode; gain: GainNode } | null = null;
export function exposureTone(level: number) {
  const ac = audio();
  if (!ac || !out || ac.state !== "running") return;
  const vol = audioSettings.get().sfx;
  if (!whine) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sawtooth";
    gain.gain.value = 0;
    const lp = ac.createBiquadFilter();
    lp.frequency.value = 2400;
    osc.connect(lp).connect(gain).connect(out);
    osc.start();
    whine = { osc, gain };
  }
  const t = ac.currentTime;
  whine.osc.frequency.setTargetAtTime(220 + level * 700, t, 0.05);
  whine.gain.gain.setTargetAtTime(level > 0.01 ? (0.03 + level * 0.1) * vol : 0, t, 0.06);
}
