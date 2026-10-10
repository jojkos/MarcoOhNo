// Tiny WebAudio synth: every sound is generated, so there are no assets to load.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function audio(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  return ctx;
}

/** Browsers only allow audio after a user gesture; call this from any tap. */
export function unlockAudio() {
  const ac = audio();
  if (ac && ac.state === "suspended") ac.resume().catch(() => {});
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", unlockAudio, { passive: true });
  window.addEventListener("keydown", unlockAudio);
}

function tone(freq: number, dur: number, opts: { type?: OscillatorType; vol?: number; at?: number; slideTo?: number } = {}) {
  const ac = audio();
  if (!ac || !master || ac.state !== "running") return;
  const t = ac.currentTime + (opts.at ?? 0);
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(freq, t);
  if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(opts.vol ?? 0.3, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function noiseBurst(dur: number, vol = 0.3, at = 0) {
  const ac = audio();
  if (!ac || !master || ac.state !== "running") return;
  const t = ac.currentTime + at;
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = vol;
  src.connect(g).connect(master);
  src.start(t);
}

export const sfx = {
  marco() {
    tone(392, 0.22, { type: "square", vol: 0.18 });
    tone(523, 0.32, { type: "square", vol: 0.18, at: 0.24 });
  },
  polo() {
    tone(523, 0.18, { type: "triangle", vol: 0.3 });
    tone(392, 0.3, { type: "triangle", vol: 0.3, at: 0.2 });
  },
  caught() {
    noiseBurst(0.45, 0.4);
    tone(180, 0.5, { type: "sawtooth", vol: 0.25, slideTo: 60 });
  },
  freed() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.15, { type: "triangle", vol: 0.22, at: i * 0.07 }));
  },
  orb() {
    tone(880, 0.12, { vol: 0.25 });
    tone(1320, 0.25, { vol: 0.2, at: 0.08 });
  },
  noise() {
    tone(140, 0.18, { type: "sine", vol: 0.35, slideTo: 90 });
  },
  dash() {
    noiseBurst(0.15, 0.15);
  },
  heartbeat(intensity: number) {
    const vol = 0.15 + intensity * 0.35;
    tone(70, 0.12, { vol });
    tone(60, 0.14, { vol: vol * 0.8, at: 0.16 });
  },
  tick() {
    tone(1000, 0.05, { type: "square", vol: 0.08 });
  },
  go() {
    tone(660, 0.4, { type: "square", vol: 0.15, slideTo: 990 });
  },
  win() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.25, { type: "triangle", vol: 0.2, at: i * 0.1 }));
  },
  lose() {
    [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, { type: "sawtooth", vol: 0.12, at: i * 0.15 }));
  },
};

/** Rising whine while a runner is being lit. Call every frame with 0..1. */
let exposureOsc: { osc: OscillatorNode; gain: GainNode } | null = null;
export function exposureTone(level: number) {
  const ac = audio();
  if (!ac || !master || ac.state !== "running") return;
  if (level <= 0.01) {
    if (exposureOsc) {
      exposureOsc.gain.gain.setTargetAtTime(0, ac.currentTime, 0.05);
    }
    return;
  }
  if (!exposureOsc) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sawtooth";
    gain.gain.value = 0;
    osc.connect(gain).connect(master);
    osc.start();
    exposureOsc = { osc, gain };
  }
  exposureOsc.osc.frequency.setTargetAtTime(220 + level * 660, ac.currentTime, 0.05);
  exposureOsc.gain.gain.setTargetAtTime(0.04 + level * 0.1, ac.currentTime, 0.05);
}

export function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported (iOS) */
  }
}
