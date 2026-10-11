// Snapshot interpolation for other players: positions are drawn slightly in the
// past (server time), between two received samples, so motion is smooth even when
// network packets arrive unevenly.

interface Sample {
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
}

export const INTERP_DELAY_MS = 110;

export class Interp {
  private buf = new Map<string, Sample[]>();

  push(id: string, t: number, x: number, y: number, vx: number, vy: number, a: number) {
    let list = this.buf.get(id);
    if (!list) this.buf.set(id, (list = []));
    const last = list[list.length - 1];
    if (last && t <= last.t) {
      // Same tick re-sent: refresh in place.
      if (t === last.t) Object.assign(last, { x, y, vx, vy, a });
      return;
    }
    list.push({ t, x, y, vx, vy, a });
    if (list.length > 30) list.shift();
  }

  forget(id: string) {
    this.buf.delete(id);
  }

  clear() {
    this.buf.clear();
  }

  /** State at server time `t`; extrapolates up to 120ms with velocity when starved. */
  sample(id: string, t: number): Sample | null {
    const list = this.buf.get(id);
    if (!list || !list.length) return null;
    if (t <= list[0].t) return list[0];
    for (let i = list.length - 1; i > 0; i--) {
      const a = list[i - 1];
      const b = list[i];
      if (a.t <= t && t <= b.t) {
        const k = (t - a.t) / Math.max(1, b.t - a.t);
        let da = b.a - a.a;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        return { t, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, vx: b.vx, vy: b.vy, a: a.a + da * k };
      }
    }
    const last = list[list.length - 1];
    const ahead = Math.min(120, t - last.t) / 1000;
    return { ...last, x: last.x + last.vx * ahead, y: last.y + last.vy * ahead };
  }
}
