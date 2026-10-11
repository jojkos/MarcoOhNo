import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import { textures } from "./textures";

interface Particle {
  s: Sprite;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size0: number;
  size1: number;
  drag: number;
  spin: number;
  alpha: number;
}

interface Timed {
  obj: Container;
  life: number;
  max: number;
  update: (t: number) => void;
}

/** Pooled particles, shockwave rings, floating text, shake and flashes. */
export class Effects {
  readonly layer = new Container();
  readonly screen = new Graphics();
  private pool: Sprite[] = [];
  private live: Particle[] = [];
  private timed: Timed[] = [];
  private shakeT = 0;
  private shakeAmp = 0;
  private flashT = 0;
  private flashMax = 1;
  private flashColor = 0xffffff;
  private flashAlpha = 0;
  offset = { x: 0, y: 0 };

  burst(
    x: number,
    y: number,
    o: { count: number; color: number; speed: number; life: number; size: number; texture?: Texture; drag?: number; spread?: number; dir?: number },
  ) {
    const tex = o.texture ?? textures().dot;
    for (let i = 0; i < o.count; i++) {
      const s = this.pool.pop() ?? new Sprite();
      s.texture = tex;
      s.anchor.set(0.5);
      s.tint = o.color;
      s.blendMode = "add";
      s.position.set(x, y);
      s.visible = true;
      s.rotation = Math.random() * Math.PI * 2;
      this.layer.addChild(s);
      const a = o.dir !== undefined ? o.dir + (Math.random() - 0.5) * (o.spread ?? 1) : Math.random() * Math.PI * 2;
      const v = o.speed * (0.35 + Math.random() * 0.65);
      const life = o.life * (0.6 + Math.random() * 0.4);
      this.live.push({
        s,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life,
        max: life,
        size0: o.size * (0.7 + Math.random() * 0.6),
        size1: o.size * 0.15,
        drag: o.drag ?? 2.5,
        spin: (Math.random() - 0.5) * 6,
        alpha: 1,
      });
    }
  }

  ring(x: number, y: number, color: number, radius: number, duration: number, width = 4) {
    const g = new Graphics();
    g.position.set(x, y);
    g.blendMode = "add";
    this.layer.addChild(g);
    this.timed.push({
      obj: g,
      life: duration,
      max: duration,
      update: (t) => {
        const e = 1 - Math.pow(1 - t, 3);
        g.clear()
          .circle(0, 0, radius * (0.15 + 0.85 * e))
          .stroke({ width: width * (1 - t) + 1, color, alpha: 1 - t });
      },
    });
  }

  text(x: number, y: number, label: string, color: number, size = 22, duration = 1.4) {
    const t = new Text({
      text: label,
      style: { fontFamily: "'Chakra Petch', sans-serif", fontWeight: "700", fontSize: size, fill: color, stroke: { color: 0x000000, width: 5 } },
      resolution: 3,
    });
    t.anchor.set(0.5);
    t.position.set(x, y - 22);
    this.layer.addChild(t);
    this.timed.push({
      obj: t,
      life: duration,
      max: duration,
      update: (k) => {
        t.y = y - 22 - 40 * (1 - Math.pow(1 - k, 2));
        t.alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        t.scale.set(k < 0.1 ? 0.6 + k * 4 : 1);
      },
    });
  }

  shake(amount: number, seconds = 0.35) {
    this.shakeAmp = Math.max(this.shakeAmp, amount);
    this.shakeT = Math.max(this.shakeT, seconds);
  }

  flash(color: number, alpha: number, seconds: number) {
    this.flashColor = color;
    this.flashAlpha = alpha;
    this.flashT = seconds;
    this.flashMax = seconds;
  }

  update(dt: number, screenW: number, screenH: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.s.visible = false;
        this.layer.removeChild(p.s);
        this.pool.push(p.s);
        this.live.splice(i, 1);
        continue;
      }
      const k = p.life / p.max;
      const damp = Math.exp(-p.drag * dt);
      p.vx *= damp;
      p.vy *= damp;
      p.s.x += p.vx * dt;
      p.s.y += p.vy * dt;
      p.s.rotation += p.spin * dt;
      const size = p.size1 + (p.size0 - p.size1) * k;
      p.s.width = p.s.height = size;
      p.s.alpha = Math.min(1, k * 2);
    }
    for (let i = this.timed.length - 1; i >= 0; i--) {
      const t = this.timed[i];
      t.life -= dt;
      if (t.life <= 0) {
        t.obj.destroy();
        this.timed.splice(i, 1);
        continue;
      }
      t.update(1 - t.life / t.max);
    }
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const a = this.shakeAmp * Math.max(0, this.shakeT) * 3;
      this.offset.x = (Math.random() - 0.5) * a;
      this.offset.y = (Math.random() - 0.5) * a;
      if (this.shakeT <= 0) this.shakeAmp = 0;
    } else {
      this.offset.x = this.offset.y = 0;
    }
    this.screen.clear();
    if (this.flashT > 0) {
      this.flashT -= dt;
      const a = this.flashAlpha * Math.max(0, this.flashT / this.flashMax);
      this.screen.rect(0, 0, screenW, screenH).fill({ color: this.flashColor, alpha: a });
    }
  }

  destroy() {
    this.layer.destroy({ children: true });
    this.screen.destroy();
    this.pool.forEach((s) => s.destroy());
  }
}
