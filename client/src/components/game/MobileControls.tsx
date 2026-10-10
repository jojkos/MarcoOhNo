import { useRef, useState } from "react";
import { Megaphone, Zap, Wind, Ghost } from "lucide-react";
import type { SnapPlayer } from "@shared/protocol";
import { abilityCooldown, abilityFor, type Ability } from "@shared/rules";
import { input } from "@/game/input";

const JOY_RADIUS = 56;
const DEADZONE = 0.12;

const ABILITY_UI: Record<Ability, { label: string; icon: typeof Zap; color: string }> = {
  polo: { label: "POLO", icon: Megaphone, color: "bg-purple-500" },
  sprint: { label: "SPRINT", icon: Zap, color: "bg-orange-500" },
  dash: { label: "DASH", icon: Wind, color: "bg-emerald-500" },
  boo: { label: "BOO", icon: Ghost, color: "bg-slate-400" },
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
          className="fixed rounded-full border-2 border-white/30 bg-white/10 pointer-events-none"
          style={{ left: base.x - JOY_RADIUS, top: base.y - JOY_RADIUS, width: JOY_RADIUS * 2, height: JOY_RADIUS * 2 }}
        >
          <div
            className="absolute w-14 h-14 rounded-full bg-white/70 shadow-lg"
            style={{ left: JOY_RADIUS - 28 + knob.x, top: JOY_RADIUS - 28 + knob.y }}
          />
        </div>
      ) : (
        <div className="absolute bottom-10 left-8 text-xs text-white/30 uppercase tracking-widest pointer-events-none">
          Drag here to move
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
      className={`relative w-[88px] h-[88px] rounded-full flex flex-col items-center justify-center text-white font-display text-xs tracking-wider shadow-xl touch-none select-none border-2 border-white/40 transition-transform active:scale-90 ${
        ready ? ui.color : "bg-zinc-700"
      }`}
      style={
        ready
          ? undefined
          : { background: `conic-gradient(rgba(255,255,255,0.35) ${pct}%, rgb(63 63 70) ${pct}% 100%)` }
      }
      onPointerDown={(e) => {
        e.preventDefault();
        if (slot === "a") input.pressA = true;
        else input.pressB = true;
      }}
      data-testid={`button-${ability}`}
    >
      <Icon className="w-7 h-7 mb-0.5" />
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
