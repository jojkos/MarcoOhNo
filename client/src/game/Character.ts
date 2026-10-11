import { Container, Graphics, Sprite, Text } from "pixi.js";
import { FACES, PLAYER, SEEKER_COLOR } from "@shared/config";
import type { Status } from "@shared/schema";
import { textures } from "./textures";

const R = PLAYER.drawRadius;

function hex(c: string) {
  return parseInt(c.replace("#", ""), 16);
}

/** Draw the face accessories that sit on the body (not the eyes' pupils). */
function drawFace(g: Graphics, face: string) {
  const dark = 0x10131f;
  switch (face) {
    case "happy":
      g.moveTo(-5, 5).arc(0, 3, 5, 0.2, Math.PI - 0.2).stroke({ width: 2, color: dark });
      g.circle(-9, 4, 2.4).fill({ color: 0xff7aa8, alpha: 0.55 });
      g.circle(9, 4, 2.4).fill({ color: 0xff7aa8, alpha: 0.55 });
      break;
    case "grin":
      g.moveTo(-6, 4).lineTo(6, 4).arc(0, 4, 6, 0, Math.PI).fill(dark);
      g.rect(-4, 4, 8, 2).fill(0xffffff);
      break;
    case "wow":
      g.ellipse(0, 7, 2.6, 3.2).fill(dark);
      break;
    case "sly":
      g.moveTo(-5, 7).lineTo(5, 5).stroke({ width: 2, color: dark });
      break;
    case "sleepy":
      g.moveTo(-3, 7).lineTo(3, 7).stroke({ width: 2, color: dark });
      break;
    case "cool":
      g.moveTo(-4, 6).quadraticCurveTo(0, 9, 5, 5).stroke({ width: 2, color: dark });
      break;
    case "nerd":
      g.moveTo(-5, 6).arc(0, 5, 5, 0.3, Math.PI - 0.3).stroke({ width: 2, color: dark });
      g.rect(-2, 6, 4, 3).fill(0xffffff);
      break;
    case "cat":
      g.moveTo(-4, 6).quadraticCurveTo(-2, 8, 0, 6).quadraticCurveTo(2, 8, 4, 6).stroke({ width: 1.6, color: dark });
      for (const s of [-1, 1]) {
        g.moveTo(s * 7, 5).lineTo(s * 14, 3).stroke({ width: 1, color: dark, alpha: 0.6 });
        g.moveTo(s * 7, 7).lineTo(s * 14, 8).stroke({ width: 1, color: dark, alpha: 0.6 });
      }
      break;
  }
}

/** Things drawn over the eyes (glasses, lids). */
function drawEyewear(g: Graphics, face: string) {
  const dark = 0x10131f;
  if (face === "cool") {
    g.roundRect(-11, -8, 9, 7, 2).fill(dark);
    g.roundRect(2, -8, 9, 7, 2).fill(dark);
    g.moveTo(-2, -5).lineTo(2, -5).stroke({ width: 1.6, color: dark });
    g.moveTo(-9, -7).lineTo(-6, -7).stroke({ width: 1, color: 0xffffff, alpha: 0.6 });
  } else if (face === "nerd") {
    g.circle(-6, -3, 5.5).stroke({ width: 1.6, color: dark });
    g.circle(6, -3, 5.5).stroke({ width: 1.6, color: dark });
    g.moveTo(-0.5, -3).lineTo(0.5, -3).stroke({ width: 1.6, color: dark });
  } else if (face === "sleepy") {
    g.rect(-11, -9, 9, 5).fill(0x000000);
    g.rect(2, -9, 9, 5).fill(0x000000);
  }
}

export class Character {
  /** Lives in the world (affected by light). */
  readonly root = new Container();
  /** Lives above the light map: name, exposure bar, rescue ring. */
  readonly label = new Container();

  private bodyWrap = new Container();
  private body: Sprite;
  private shadow: Sprite;
  private pupils = new Graphics();
  private eyes = new Graphics();
  private cage = new Graphics();
  private shieldRing = new Graphics();
  private flashlight?: Graphics;
  private nameText: Text;
  private bar = new Graphics();
  private ring = new Graphics();
  private t = Math.random() * 10;
  private look = 0;
  private status: Status = "free";
  readonly isSeeker: boolean;

  constructor(opts: { name: string; color: string; face: number; seeker: boolean; me: boolean }) {
    const tex = textures();
    this.isSeeker = opts.seeker;
    const color = hex(opts.seeker ? SEEKER_COLOR : opts.color);
    const faceName = FACES[opts.face] ?? "happy";

    this.shadow = new Sprite(tex.shadow);
    this.shadow.anchor.set(0.5);
    this.shadow.width = R * 2.4;
    this.shadow.height = R * 1.1;
    this.shadow.y = R * 0.85;
    this.shadow.alpha = 0.6;

    this.body = new Sprite(tex.body);
    this.body.anchor.set(0.5);
    this.body.width = this.body.height = R * 2;
    this.body.tint = color;

    if (faceName === "cat") {
      const ears = new Graphics();
      for (const s of [-1, 1]) ears.poly([s * 4, -R + 3, s * 13, -R - 6, s * 14, -R + 7]).fill(color);
      this.bodyWrap.addChild(ears);
    }
    this.bodyWrap.addChild(this.body);

    // Eyes
    this.eyes.ellipse(-6, -3, 4.6, 5.6).fill(0xffffff);
    this.eyes.ellipse(6, -3, 4.6, 5.6).fill(0xffffff);
    this.bodyWrap.addChild(this.eyes, this.pupils);

    const face = new Graphics();
    drawFace(face, faceName);
    drawEyewear(face, faceName);
    this.bodyWrap.addChild(face);

    if (opts.seeker) {
      // Visor with a glowing slit, and a headlamp.
      const visor = new Graphics();
      visor.roundRect(-13, -9, 26, 10, 4).fill(0x0b0d16);
      visor.roundRect(-10, -6, 20, 3, 1.5).fill(0xff3b5c);
      this.bodyWrap.addChild(visor);
      this.eyes.visible = false;
      this.pupils.visible = false;
      this.flashlight = new Graphics();
      this.flashlight.roundRect(-3, -4, 9, 8, 2).fill(0x2a2f45).circle(7, 0, 3.4).fill(0xfff1a8);
      this.bodyWrap.addChild(this.flashlight);
    }

    this.shieldRing.circle(0, 0, R + 7).stroke({ width: 2, color: 0x38d6ff, alpha: 0.9 }).circle(0, 0, R + 7).fill({ color: 0x38d6ff, alpha: 0.1 });
    this.shieldRing.visible = false;

    for (let x = -14; x <= 14; x += 7) this.cage.moveTo(x, -22).lineTo(x, 18);
    this.cage.stroke({ width: 3, color: 0xd5deea });
    this.cage.roundRect(-18, -24, 36, 44, 4).stroke({ width: 3, color: 0xd5deea });
    this.cage.visible = false;

    this.root.addChild(this.shadow, this.bodyWrap, this.cage, this.shieldRing);

    this.nameText = new Text({
      text: opts.name,
      style: {
        fontFamily: "Outfit, sans-serif",
        fontWeight: "700",
        fontSize: 13,
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 4 },
      },
      resolution: 3,
    });
    this.nameText.anchor.set(0.5, 1);
    this.nameText.y = -R - 8;
    if (opts.me) this.nameText.style.fill = 0xfff3b0;
    this.label.addChild(this.ring, this.bar, this.nameText);
  }

  setStatus(status: Status) {
    if (status === this.status) return;
    this.status = status;
    this.cage.visible = status === "caged";
    this.root.alpha = status === "ghost" ? 0.45 : 1;
    this.shadow.visible = status !== "ghost";
  }

  update(dt: number, x: number, y: number, vx: number, vy: number, angle: number, extra: { exposure: number; rescue: number; invuln: boolean }) {
    this.t += dt;
    const speed = Math.hypot(vx, vy);
    const s = Math.min(1, speed / PLAYER.runnerSpeed);
    this.root.position.set(x, y);
    this.label.position.set(x, y);

    // Squash and stretch + a little bounce in the stride.
    const bounce = Math.abs(Math.sin(this.t * 13)) * 3 * s;
    const breathe = Math.sin(this.t * 2.2) * 0.025;
    this.bodyWrap.y = -bounce;
    this.bodyWrap.scale.set(1 + 0.07 * s + breathe, 1 - 0.07 * s - breathe);
    if (this.status === "ghost") this.bodyWrap.y = -4 + Math.sin(this.t * 3) * 3;
    this.shadow.scale.x = (R * 2.4) / 64 * (1 - bounce * 0.03);

    // Eyes look where you're heading (or where the flashlight points).
    const target = speed > 15 ? Math.atan2(vy, vx) : angle;
    let d = target - this.look;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.look += d * Math.min(1, dt * 12);
    const lx = Math.cos(this.look);
    const ly = Math.sin(this.look);
    this.pupils.clear();
    this.pupils.circle(-6 + lx * 1.9, -3 + ly * 2.2, 2.5).fill(0x10131f);
    this.pupils.circle(6 + lx * 1.9, -3 + ly * 2.2, 2.5).fill(0x10131f);
    if (this.flashlight) {
      this.flashlight.rotation = angle;
      this.flashlight.position.set(Math.cos(angle) * 9, Math.sin(angle) * 9 + 3);
    }

    this.shieldRing.visible = extra.invuln;
    if (extra.invuln) this.shieldRing.alpha = 0.6 + Math.sin(this.t * 10) * 0.3;

    this.bar.clear();
    if (extra.exposure > 0 && this.status === "free") {
      const w = 38;
      this.bar.roundRect(-w / 2, R + 8, w, 6, 3).fill({ color: 0x000000, alpha: 0.75 });
      this.bar.roundRect(-w / 2, R + 8, w * Math.min(1, extra.exposure), 6, 3).fill(extra.exposure > 0.7 ? 0xff2d55 : 0xff8a3d);
    }
    this.ring.clear();
    if (this.status === "caged" && extra.rescue > 0) {
      this.ring.arc(0, 0, R + 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * extra.rescue).stroke({ width: 4, color: 0x3dffb5 });
    }
  }

  destroy() {
    this.root.destroy({ children: true });
    this.label.destroy({ children: true });
  }
}
