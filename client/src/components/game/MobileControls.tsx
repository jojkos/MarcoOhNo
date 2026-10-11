import { useRef, useState } from "react";
import { Megaphone, Zap, Wind, Ghost } from "lucide-react";
import type { SnapPlayer } from "@shared/protocol";
import { abilityCooldown, abilityFor, type Ability } from "@shared/rules";
import { input } from "@/game/input";

const JOY_RADIUS = 56;
const DEADZONE = 0.12;

const ABILITY_UI: Record<Ability, { label: string; icon: typeof Zap; bg: string; glow: string }> = {
  polo: { label: "POLO", icon: Megaphone, bg: "linear-gradient(135deg,#c89bff,#7b3dff)", glow: "rgba(138,77,255,0.75)" },
  sprint: { label: "SPRINT", icon: Zap, bg: "linear-gradient(135deg,#ffc27a,#ff7a1a)", glow: "rgba(255,122,26,0.7)" },
  dash: { label: "DASH", icon: Wind, bg: "linear-gradient(135deg,#9dffd8,#16c98a)", glow: "rgba(34,227,154,0.7)" },
  boo: { label: "BOO", icon: Ghost, bg: "linear-gradient(135deg,#e2e8f0,#7c8aa5)", glow: "rgba(200,210,230,0.5)" },
};

/** Floating joystick: touch anywhere on the left side of the screen. */
function Joystick() {
  const [base, setBase] = useState<{ x: number; y: number } | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const pointer = useRef<number | null>(null);

  const update = (clientX: number, clientY: number, origin: { x: number; y: number }) => {
    let dx = clientX - origin.x;
    let dy = clientY - origin.y;
    const len = Math.hypot(dx, dy);
    if (len > JOY_RADIUS) {
      dx = (dx / len) * JOY_RADIUS;
      dy = (dy / len) * JOY_RADIUS;
    }
    setKnob({ x: dx, y: dy });
    const mag = Math.min(1, len / JOY_RADIUS);
    if (mag < DEADZONE) {
      input.joyX = 0;
      input.joyY = 0;
    } else {
      // Ease out of the deadzone so small pushes allow slow sneaking.
      const scaled = Math.min(1, (mag - DEADZONE) / (0.8 - DEADZONE));
      input.joyX = (dx / (len || 1)) * scaled;
      input.joyY = (dy / (len || 1)) * scaled;
    }
  };

  const end = () => {
    pointer.current = null;
    setBase(null);
    setKnob({ x: 0, y: 0 });
    input.joyX = 0;
    input.joyY = 0;
  };

  return (
    <div
      className="absolute left-0 bottom-0 top-16 w-[60%] touch-none select-none"
      onPointerDown={(e) => {
        if (pointer.current !== null) return;
        pointer.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        const origin = { x: e.clientX, y: e.clientY };
        setBase(origin);
        update(e.clientX, e.clientY, origin);
      }}
      onPointerMove={(e) => {
        if (e.pointerId !== pointer.current || !base) return;
        update(e.clientX, e.clientY, base);
      }}
      onPointerUp={(e) => e.pointerId === pointer.current && end()}
      onPointerCancel={(e) => e.pointerId === pointer.current && end()}
      data-testid="control-joystick"
    >
      {base ? (
        <div
          className="pointer-events-none fixed rounded-full border-2 border-neon-cyan/40 bg-neon-cyan/[0.06] shadow-[0_0_30px_-6px_hsl(var(--primary)/0.6)]"
          style={{ left: base.x - JOY_RADIUS, top: base.y - JOY_RADIUS, width: JOY_RADIUS * 2, height: JOY_RADIUS * 2 }}
        >
          <div
            className="absolute h-14 w-14 rounded-full bg-[radial-gradient(circle_at_35%_30%,#ffffff,#9fe9ff)] shadow-[0_0_24px_2px_hsl(var(--primary)/0.7)]"
            style={{ left: JOY_RADIUS - 28 + knob.x, top: JOY_RADIUS - 28 + knob.y }}
          />
        </div>
      ) : (
        <div className="pointer-events-none absolute bottom-[max(2.5rem,env(safe-area-inset-bottom))] left-8 flex items-center gap-3 text-xs uppercase tracking-[0.25em] text-white/30">
          <span className="h-12 w-12 rounded-full border-2 border-dashed border-white/20" />
          Drag to move
        </div>
      )}
    </div>
  );
}

function AbilityButton({ ability, cooldown, slot }: { ability: Ability; cooldown: number; slot: "a" | "b" }) {
  const ui = ABILITY_UI[ability];
  const Icon = ui.icon;
  const ready = cooldown <= 0;
  const pct = ready ? 100 : 100 - (cooldown / abilityCooldown(ability)) * 100;
  return (
    <button
      className="relative flex h-[88px] w-[88px] touch-none select-none flex-col items-center justify-center rounded-full border-2 border-white/30 font-display text-xs font-bold tracking-wider text-white transition-transform active:scale-90"
      style={
        ready
          ? { background: ui.bg, boxShadow: `0 0 30px -4px ${ui.glow}, inset 0 2px 0 rgba(255,255,255,0.35)`, textShadow: "0 1px 2px rgba(0,0,0,0.4)" }
          : { background: `conic-gradient(rgba(255,255,255,0.28) ${pct}%, rgb(30 33 48) ${pct}% 100%)` }
      }
      onPointerDown={(e) => {
        e.preventDefault();
        if (slot === "a") input.pressA = true;
        else input.pressB = true;
      }}
      data-testid={`button-${ability}`}
    >
      <Icon className="mb-0.5 h-7 w-7" />
      {ready ? ui.label : Math.ceil(cooldown / 1000)}
    </button>
  );
}

export function MobileControls({ me }: { me: SnapPlayer }) {
  const a = abilityFor(me.role, me.status, "a");
  const b = abilityFor(me.role, me.status, "b");
  return (
    <>
      <Joystick />
      <div className="absolute right-4 bottom-[max(1.5rem,env(safe-area-inset-bottom))] flex flex-col items-center gap-4 z-20">
        {b && <AbilityButton ability={b} cooldown={me.cdB} slot="b" />}
        {a && <AbilityButton ability={a} cooldown={me.cdA} slot="a" />}
      </div>
    </>
  );
}
