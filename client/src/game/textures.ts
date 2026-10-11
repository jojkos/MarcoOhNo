// Procedurally generated textures (no image assets to download).
import { Texture } from "pixi.js";

function canvas(w: number, h = w) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}

/** Deterministic noise so textures look the same every load. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function radial(size: number, stops: [number, number][]) {
  const [c, g] = canvas(size);
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, alpha] of stops) grad.addColorStop(at, `rgba(255,255,255,${alpha})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return Texture.from(c);
}

let cache: ReturnType<typeof build> | null = null;

function build() {
  // Light falloff: bright core, long soft tail. Sampled by light meshes via UVs.
  const light = radial(256, [
    [0, 1],
    [0.35, 0.95],
    [0.65, 0.7],
    [0.85, 0.32],
    [1, 0],
  ]);
  const glow = radial(128, [
    [0, 1],
    [0.3, 0.55],
    [0.7, 0.12],
    [1, 0],
  ]);
  const dot = radial(32, [
    [0, 1],
    [0.5, 0.8],
    [1, 0],
  ]);

  // Character body: white sphere shading, tinted per player.
  const body = (() => {
    const [c, g] = canvas(96);
    const grad = g.createRadialGradient(36, 30, 4, 48, 48, 46);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.45, "rgba(235,235,235,1)");
    grad.addColorStop(1, "rgba(150,150,150,1)");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(48, 48, 46, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(255,255,255,0.55)";
    g.lineWidth = 3;
    g.stroke();
    return Texture.from(c);
  })();

  const shadow = (() => {
    const [c, g] = canvas(64, 32);
    const grad = g.createRadialGradient(32, 16, 2, 32, 16, 30);
    grad.addColorStop(0, "rgba(0,0,0,0.7)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.scale(1, 0.5);
    g.beginPath();
    g.arc(32, 32, 30, 0, Math.PI * 2);
    g.fill();
    return Texture.from(c);
  })();

  // Floor tile: worn concrete panels with seams, grime and painted guide lines.
  // Authored fairly bright: the light map multiplies it down to black.
  const floor = (() => {
    const S = 240;
    const [c, g] = canvas(S);
    const r = rng(7);
    g.fillStyle = "#3a4466";
    g.fillRect(0, 0, S, S);
    // Panels with slightly varied tone.
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 2; x++) {
        const v = Math.floor(r() * 14) - 7;
        g.fillStyle = `rgb(${58 + v},${68 + v},${102 + v})`;
        g.fillRect(x * 120 + 2, y * 120 + 2, 116, 116);
      }
    for (let i = 0; i < 3200; i++) {
      const v = Math.floor(r() * 40);
      g.fillStyle = r() < 0.5 ? `rgba(${90 + v},${105 + v},${150 + v},${0.08 + r() * 0.1})` : `rgba(10,14,28,${0.08 + r() * 0.12})`;
      g.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2);
    }
    for (let i = 0; i < 16; i++) {
      g.fillStyle = `rgba(8,10,20,${0.08 + r() * 0.12})`;
      g.beginPath();
      g.ellipse(r() * S, r() * S, 10 + r() * 34, 6 + r() * 22, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
    // Cracks.
    g.strokeStyle = "rgba(10,12,24,0.45)";
    g.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      let x = r() * S;
      let y = r() * S;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) {
        x += (r() - 0.5) * 26;
        y += (r() - 0.5) * 26;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // Seams.
    g.strokeStyle = "rgba(12,16,32,0.9)";
    g.lineWidth = 3;
    for (const p of [0, S / 2]) {
      g.beginPath();
      g.moveTo(p + 1, 0);
      g.lineTo(p + 1, S);
      g.moveTo(0, p + 1);
      g.lineTo(S, p + 1);
      g.stroke();
    }
    // Bolts at panel corners.
    g.fillStyle = "rgba(160,180,230,0.35)";
    for (const x of [8, 112, 128, 232]) for (const y of [8, 112, 128, 232]) g.fillRect(x - 1.5, y - 1.5, 3, 3);
    return Texture.from(c);
  })();

  const smoke = (() => {
    const [c, g] = canvas(128);
    const r = rng(11);
    for (let i = 0; i < 26; i++) {
      const x = 30 + r() * 68;
      const y = 30 + r() * 68;
      const rad = 14 + r() * 26;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, "rgba(255,255,255,0.22)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
    }
    return Texture.from(c);
  })();

  const spark = (() => {
    const [c, g] = canvas(64);
    g.translate(32, 32);
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, 30);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rr = i % 2 ? 7 : 30;
      g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
    return Texture.from(c);
  })();

  return { light, glow, dot, body, shadow, floor, smoke, spark };
}

export function textures() {
  cache ??= build();
  return cache;
}
