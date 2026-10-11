import { BlurFilter, Container, MeshSimple, RenderTexture, Sprite, type Renderer } from "pixi.js";
import type { Vec } from "@shared/geometry";
import { textures } from "./textures";

/**
 * One light: a triangle fan shaped by its visibility polygon (so walls cast
 * shadows), textured with a radial falloff mapped around the light's origin.
 */
class LightMesh {
  readonly mesh: MeshSimple;
  readonly capacity: number;
  private positions: Float32Array;
  private uvs: Float32Array;

  /** `closed` = full circle (fan wraps around); cones don't wrap. */
  constructor(capacity: number, readonly closed: boolean) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 2);
    this.uvs = new Float32Array(capacity * 2);
    this.mesh = new MeshSimple({
      texture: textures().light,
      vertices: this.positions,
      uvs: this.uvs,
      indices: LightMesh.fanIndices(capacity, closed),
    });
    this.mesh.blendMode = "add";
  }

  /** Vertex 0 = centre, 1..n-1 = rim. */
  static fanIndices(n: number, closed: boolean) {
    const tris = closed ? n - 1 : n - 2;
    const idx = new Uint32Array(tris * 3);
    for (let i = 1; i <= tris; i++) {
      const j = i === n - 1 ? 1 : i + 1;
      idx.set([0, i, j], (i - 1) * 3);
    }
    return idx;
  }

  set(center: Vec, rim: readonly Vec[], radius: number, color: number, alpha: number, bleed: number) {
    const pos = this.positions;
    const uv = this.uvs;
    const inv = 1 / (2 * radius);
    pos[0] = center.x;
    pos[1] = center.y;
    uv[0] = 0.5;
    uv[1] = 0.5;
    // Unused slots repeat the last rim point (degenerate triangles).
    for (let i = 0; i < this.capacity - 1; i++) {
      const p = rim[Math.min(i, rim.length - 1)];
      let x = p.x;
      let y = p.y;
      // Rays that stopped on a wall push a little into it so the wall top lights up.
      const dx = x - center.x;
      const dy = y - center.y;
      const d = Math.hypot(dx, dy);
      if (bleed > 0 && d > 1 && d < radius - 2) {
        const k = Math.min(bleed, radius - d) / d;
        x += dx * k;
        y += dy * k;
      }
      pos[(i + 1) * 2] = x;
      pos[(i + 1) * 2 + 1] = y;
      uv[(i + 1) * 2] = 0.5 + (x - center.x) * inv;
      uv[(i + 1) * 2 + 1] = 0.5 + (y - center.y) * inv;
    }
    this.mesh.geometry.positions = pos;
    this.mesh.geometry.uvs = uv;
    this.mesh.tint = color;
    this.mesh.alpha = alpha;
    this.mesh.visible = true;
  }
}

export interface LightSpec {
  key: string;
  center: Vec;
  /** Visibility polygon rim points (no centre). */
  rim: readonly Vec[];
  radius: number;
  color: number;
  alpha: number;
  /** Full circle (true) or cone (false). */
  closed: boolean;
  /** How far light spills into the walls it hits (px). */
  bleed?: number;
}

/**
 * Light map: lights are drawn additively into a half-resolution render texture
 * cleared to the ambient colour, then multiplied over the world.
 */
export class Lighting {
  readonly sprite: Sprite;
  /** The same light map added on top at low alpha: beams glow in the haze. */
  readonly haze: Sprite;
  private rt: RenderTexture;
  private layer = new Container();
  private meshes = new Map<string, LightMesh>();
  private used = new Set<string>();
  private blur: BlurFilter;
  ambient = 0x000000;

  constructor(
    private renderer: Renderer,
    private resolution = 0.5,
  ) {
    this.rt = RenderTexture.create({ width: 16, height: 16 });
    this.sprite = new Sprite(this.rt);
    this.sprite.blendMode = "multiply";
    this.haze = new Sprite(this.rt);
    this.haze.blendMode = "add";
    this.haze.alpha = 0.22;
    this.blur = new BlurFilter({ strength: 6, quality: 2 });
    this.layer.filters = [this.blur];
  }

  resize(w: number, h: number) {
    const rw = Math.max(16, Math.ceil(w * this.resolution));
    const rh = Math.max(16, Math.ceil(h * this.resolution));
    this.rt.resize(rw, rh);
    this.sprite.scale.set(1 / this.resolution);
    this.haze.scale.set(1 / this.resolution);
  }

  begin() {
    this.used.clear();
  }

  add(spec: LightSpec) {
    if (spec.rim.length < 2) return;
    let m = this.meshes.get(spec.key);
    const needed = spec.rim.length + 1;
    if (!m || m.capacity < needed || m.closed !== spec.closed) {
      m?.mesh.destroy();
      m = new LightMesh(Math.max(needed, 8), spec.closed);
      this.meshes.set(spec.key, m);
      this.layer.addChild(m.mesh);
    }
    m.set(spec.center, spec.rim, spec.radius, spec.color, spec.alpha, spec.bleed ?? 18);
    this.used.add(spec.key);
  }

  /** Render lights into the map. `camX/camY/zoom` = world->screen transform. */
  end(camX: number, camY: number, zoom: number) {
    for (const [key, m] of this.meshes) {
      if (!this.used.has(key)) m.mesh.visible = false;
    }
    const r = this.resolution;
    this.layer.scale.set(zoom * r);
    this.layer.position.set(-camX * zoom * r, -camY * zoom * r);
    this.blur.strength = Math.max(2, 7 * zoom * r * 2);
    this.renderer.render({ container: this.layer, target: this.rt, clear: true, clearColor: this.ambient });
  }

  destroy() {
    this.layer.destroy({ children: true });
    this.rt.destroy(true);
    this.sprite.destroy();
    this.haze.destroy();
  }
}
