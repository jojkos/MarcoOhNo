import { ABILITIES, MOVE_SEND_HZ, PLAYER } from "@shared/config";
import { stepBody, turnTowards } from "@shared/physics";
import { abilityAllowed, abilityFor, baseSpeed, isFrozen } from "@shared/rules";
import type { Rect } from "@shared/geometry";
import type { Phase, Player } from "@shared/schema";
import { send } from "@/lib/session";
import { input, readMove, takePresses } from "./input";

/**
 * The phone's own character. Moves instantly on this device (no waiting for
 * the server) and reports its position; the server only steps in if a move is
 * physically impossible.
 */
export class LocalMover {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  angle = 0;
  ready = false;
  private boostMul = 1;
  private boostLeft = 0;
  private sendAcc = 0;
  private lastSent = { x: NaN, y: NaN, a: NaN };
  private idleSendAcc = 0;
  /** Visual smoothing after a correction. */
  private errX = 0;
  private errY = 0;
  private lockCd = { a: 0, b: 0 };
  private wasFrozen = true;

  reset(p: Player) {
    this.x = p.x;
    this.y = p.y;
    this.vx = this.vy = 0;
    this.angle = p.angle;
    this.errX = this.errY = 0;
    this.boostLeft = 0;
    this.ready = true;
  }

  /** Server rejected a move: jump to its position (visually eased), keep momentum. */
  correct(x: number, y: number) {
    this.errX += this.x - x;
    this.errY += this.y - y;
    this.x = x;
    this.y = y;
  }

  /** Visual position (with any correction easing out). */
  get drawX() {
    return this.x + this.errX;
  }
  get drawY() {
    return this.y + this.errY;
  }

  update(dt: number, me: Player, phase: Phase, map: { width: number; height: number; rects: readonly Rect[] }) {
    if (!this.ready) this.reset(me);
    const decay = Math.exp(-dt * 12);
    this.errX *= decay;
    this.errY *= decay;

    const frozen = isFrozen(me, phase);
    if (frozen) {
      // The server moves frozen players (spawn, lockers, cages): follow it.
      this.x += (me.x - this.x) * Math.min(1, dt * 20);
      this.y += (me.y - this.y) * Math.min(1, dt * 20);
      this.vx = this.vy = 0;
      this.wasFrozen = true;
    } else if (this.wasFrozen) {
      this.x = me.x;
      this.y = me.y;
      this.wasFrozen = false;
    }

    // Abilities: predict boosts locally for instant feel; the server confirms.
    for (const slot of takePresses()) {
      send.action(slot);
      if (slot !== "a" && slot !== "b") continue;
      const ability = abilityFor(me.role, me.status, slot);
      const cd = slot === "a" ? me.cdA : me.cdB;
      if (!ability || !abilityAllowed(ability, phase) || cd > 0 || performance.now() < this.lockCd[slot] || frozen) continue;
      if (ability === "dash" || ability === "sprint") {
        this.lockCd[slot] = performance.now() + 500;
        const cfg = ability === "dash" ? ABILITIES.dash : ABILITIES.sprint;
        this.boostMul = cfg.multiplier;
        this.boostLeft = cfg.durationMs / 1000;
        if (ability === "dash") {
          const a = Math.hypot(this.vx, this.vy) > 20 ? Math.atan2(this.vy, this.vx) : this.angle;
          const v = PLAYER.runnerSpeed * cfg.multiplier;
          this.vx = Math.cos(a) * v;
          this.vy = Math.sin(a) * v;
        }
      }
    }
    if (this.boostLeft > 0) {
      this.boostLeft -= dt;
      if (this.boostLeft <= 0) this.boostMul = 1;
    }

    const { mx, my } = readMove();
    if (!frozen) {
      stepBody(this, mx, my, dt, {
        maxSpeed: baseSpeed(me.role, me.status) * Math.max(this.boostMul, me.boost),
        ghost: me.status === "ghost",
        frozen: false,
        width: map.width,
        height: map.height,
        rects: map.rects,
      });
    }

    // Facing: the seeker's flashlight sweeps (turn rate); runners face where they go.
    if (Math.hypot(mx, my) > 0.15) {
      const target = Math.atan2(my, mx);
      this.angle = me.role === "seeker" ? turnTowards(this.angle, target, PLAYER.seekerTurnRate, dt) : target;
    }

    input.selfX = this.x;
    input.selfY = this.y;

    // Frozen players are moved by the server; reporting would only earn corrections.
    if (frozen) return;
    // Report position at a steady rate (slower when idle). Keep the remainder so 60 Hz
    // frames give an even 30 Hz, not a 20/30 Hz mix that stutters on other screens.
    this.sendAcc += dt;
    this.idleSendAcc += dt;
    if (this.sendAcc >= 1 / MOVE_SEND_HZ) {
      this.sendAcc -= 1 / MOVE_SEND_HZ;
      if (this.sendAcc > 1 / MOVE_SEND_HZ) this.sendAcc = 0;
      const moved = this.x !== this.lastSent.x || this.y !== this.lastSent.y || Math.abs(this.angle - this.lastSent.a) > 0.01;
      if (moved || this.idleSendAcc > 0.25) {
        this.idleSendAcc = 0;
        this.lastSent = { x: this.x, y: this.y, a: this.angle };
        send.move({ x: round2(this.x), y: round2(this.y), vx: round2(this.vx), vy: round2(this.vy), a: Math.round(this.angle * 1000) / 1000 });
      }
    }
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
