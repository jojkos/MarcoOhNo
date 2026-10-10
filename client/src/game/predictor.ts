import type { InputMsg, SnapPlayer } from "@shared/protocol";
import { stepMover, type MoveCtx, type MoverState } from "@shared/physics";

interface Pending extends InputMsg {
  /** Boost we predicted this input triggered (dash/sprint), replayed on reconcile. */
  boost?: { steps: number; mul: number };
}

/**
 * Client-side prediction for the local player: apply inputs immediately with
 * the same physics as the server, then rewind to each authoritative snapshot
 * and replay inputs the server hasn't processed yet.
 */
export class Predictor {
  state: MoverState = { x: 0, y: 0, angle: 0, boost: 0, boostMul: 1 };
  private prev = { x: 0, y: 0 };
  private pending: Pending[] = [];
  private seq = 0;
  /** Visual offset left over from corrections, decays to zero so fixes don't snap. */
  private errX = 0;
  private errY = 0;
  ready = false;

  reset(p: SnapPlayer) {
    this.state = { x: p.x, y: p.y, angle: p.angle, boost: p.boost, boostMul: p.boostMul };
    this.prev = { x: p.x, y: p.y };
    this.pending = [];
    this.seq = Math.max(this.seq, p.ack);
    this.errX = this.errY = 0;
    this.ready = true;
  }

  /** Run one fixed step locally and return the message to send. */
  step(mx: number, my: number, abilities: { a: boolean; b: boolean }, boost: Pending["boost"], ctx: MoveCtx): InputMsg {
    const msg: Pending = { seq: ++this.seq, mx, my };
    if (abilities.a) msg.a = 1;
    if (abilities.b) msg.b = 1;
    if (boost) {
      msg.boost = boost;
      this.state.boost = boost.steps;
      this.state.boostMul = boost.mul;
    }
    this.prev = { x: this.state.x, y: this.state.y };
    stepMover(this.state, mx, my, ctx);
    this.pending.push(msg);
    if (this.pending.length > 120) this.pending.shift();
    const { boost: _local, ...wire } = msg;
    return wire;
  }

  reconcile(server: SnapPlayer, ctx: MoveCtx) {
    if (!this.ready) return this.reset(server);
    const before = { x: this.state.x, y: this.state.y };
    this.pending = this.pending.filter((p) => p.seq > server.ack);
    this.state = { x: server.x, y: server.y, angle: server.angle, boost: server.boost, boostMul: server.boostMul };
    for (const p of this.pending) {
      if (p.boost) {
        this.state.boost = p.boost.steps;
        this.state.boostMul = p.boost.mul;
      }
      stepMover(this.state, p.mx, p.my, ctx);
    }
    const dx = before.x - this.state.x;
    const dy = before.y - this.state.y;
    if (Math.hypot(dx, dy) > 120) {
      // Teleport-sized correction (respawn, desync): snap.
      this.errX = this.errY = 0;
      this.prev = { x: this.state.x, y: this.state.y };
    } else {
      // Shift the whole interpolation segment so nothing visibly jumps; the error then fades out.
      this.prev.x -= dx;
      this.prev.y -= dy;
      this.errX += dx;
      this.errY += dy;
    }
  }

  /** Position to draw, interpolated between fixed steps (alpha 0..1). */
  renderPos(alpha: number, dtMs: number): { x: number; y: number } {
    const decay = Math.exp(-dtMs / 90);
    this.errX *= decay;
    this.errY *= decay;
    return {
      x: this.prev.x + (this.state.x - this.prev.x) * alpha + this.errX,
      y: this.prev.y + (this.state.y - this.prev.y) * alpha + this.errY,
    };
  }
}
