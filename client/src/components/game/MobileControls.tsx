import { useRef, useState } from "react";
import { Megaphone, Zap, Wind, Ghost, Siren, Cloud, Copy, Sun, Flame, Target, DoorOpen, DoorClosed, Search, type LucideIcon } from "lucide-react";
import { RULES } from "@shared/config";
import { abilityCooldown, abilityFor, type Ability } from "@shared/rules";
import type { ActionSlot } from "@shared/protocol";
import { input, press } from "@/game/input";
import { getRoom } from "@/lib/session";
import type { PlayerView } from "@/lib/gameStore";
import { haptic } from "@/audio/haptics";
import { cn } from "@/lib/utils";

const JOY_RADIUS = 58;
const DEADZONE = 0.1;

type Look = { label: string; icon: LucideIcon; bg: string; glow: string };

const ABILITY_UI: Record<Ability, Look> = {
  polo: { label: "POLO", icon: Megaphone, bg: "linear-gradient(135deg,#c89bff,#7b3dff)", glow: "rgba(138,77,255,0.75)" },
  sprint: { label: "SPRINT", icon: Zap, bg: "linear-gradient(135deg,#ffc27a,#ff7a1a)", glow: "rgba(255,122,26,0.7)" },
  dash: { label: "DASH", icon: Wind, bg: "linear-gradient(135deg,#9dffd8,#16c98a)", glow: "rgba(34,227,154,0.7)" },
  boo: { label: "BOO", icon: Ghost, bg: "linear-gradient(135deg,#e2e8f0,#7c8aa5)", glow: "rgba(200,210,230,0.5)" },
  help: { label: "HELP", icon: Siren, bg: "linear-gradient(135deg,#9dffd8,#16c98a)", glow: "rgba(34,227,154,0.7)" },
};

const ITEM_UI: Record<string, Look> = {
  smoke: { label: "SMOKE", icon: Cloud, bg: "linear-gradient(135deg,#e2e8f0,#64748b)", glow: "rgba(200,210,230,0.5)" },
  decoy: { label: "DECOY", icon: Copy, bg: "linear-gradient(135deg,#d8b4fe,#9333ea)", glow: "rgba(168,85,247,0.6)" },
  flash: { label: "FLASH", icon: Sun, bg: "linear-gradient(135deg,#fffbe0,#facc15)", glow: "rgba(250,204,21,0.7)" },
  flare: { label: "FLARE", icon: Flame, bg: "linear-gradient(135deg,#fdba74,#ea580c)", glow: "rgba(234,88,12,0.7)" },
  trap: { label: "TRAP", icon: Target, bg: "linear-gradient(135deg,#fda4af,#e11d48)", glow: "rgba(225,29,72,0.7)" },
};

const ACT_UI: Record<"hide" | "leave" | "search", Look> = {
  hide: { label: "HIDE", icon: DoorClosed, bg: "linear-gradient(135deg,#93c5fd,#2563eb)", glow: "rgba(37,99,235,0.7)" },
  leave: { label: "LEAVE", icon: DoorOpen, bg: "linear-gradient(135deg,#93c5fd,#2563eb)", glow: "rgba(37,99,235,0.7)" },
  search: { label: "SEARCH", icon: Search, bg: "linear-gradient(135deg,#fda4af,#e11d48)", glow: "rgba(225,29,72,0.7)" },
};

/** Floating joystick: touch anywhere on the left part of the screen. */
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
      // Ease out of the deadzone; small pushes let you sneak slowly.
      const scaled = Math.min(1, (mag - DEADZONE) / (0.75 - DEADZONE));
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
      className="absolute bottom-0 left-0 top-16 w-[58%] touch-none select-none"
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

function ActionButton({
  look,
  slot,
  size,
  cooldown = 0,
  cooldownMax = 1,
  progress,
  testId,
}: {
  look: Look;
  slot: ActionSlot;
  size: number;
  cooldown?: number;
  cooldownMax?: number;
  progress?: number;
  testId: string;
}) {
  const Icon = look.icon;
  const ready = cooldown <= 0;
  const pct = ready ? 100 : 100 - (cooldown / cooldownMax) * 100;
  return (
    <button
      className={cn(
        "relative flex touch-none select-none flex-col items-center justify-center rounded-full border-2 border-white/30 font-display font-bold tracking-wider text-white transition-transform active:scale-90",
        size >= 80 ? "text-xs" : "text-[10px]",
      )}
      style={{
        width: size,
        height: size,
        ...(ready
          ? { background: look.bg, boxShadow: `0 0 30px -4px ${look.glow}, inset 0 2px 0 rgba(255,255,255,0.35)`, textShadow: "0 1px 2px rgba(0,0,0,0.4)" }
          : { background: `conic-gradient(rgba(255,255,255,0.28) ${pct}%, rgb(30 33 48) ${pct}% 100%)` }),
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        press(slot);
        haptic.tap();
      }}
      data-testid={testId}
    >
      {progress !== undefined && progress > 0 && (
        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="47" fill="none" stroke="white" strokeWidth="5" strokeDasharray={`${progress * 295} 295`} />
        </svg>
      )}
      <Icon className={size >= 80 ? "mb-0.5 h-7 w-7" : "mb-0.5 h-5 w-5"} />
      {ready ? look.label : Math.ceil(cooldown / 1000)}
    </button>
  );
}

/** Context action: hide/leave a locker (runner) or search one (seeker). */
function contextAction(me: PlayerView): "hide" | "leave" | "search" | null {
  if (me.role === "runner") {
    if (me.status !== "free") return null;
    if (me.locker >= 0) return "leave";
  }
  const lockers = getRoom()?.state.round?.lockers;
  if (!lockers) return null;
  let near = false;
  lockers.forEach((l) => {
    if (Math.hypot(l.x - me.x, l.y - me.y) <= RULES.lockerRange && !(me.role === "seeker" && l.checked)) near = true;
  });
  if (!near) return null;
  return me.role === "seeker" ? "search" : "hide";
}

export function MobileControls({ me, hunt }: { me: PlayerView; hunt: boolean }) {
  const a = abilityFor(me.role, me.status, "a");
  const b = abilityFor(me.role, me.status, "b");
  const act = hunt ? contextAction(me) : null;
  const item = me.item ? ITEM_UI[me.item] : undefined;
  return (
    <>
      {me.locker < 0 && <Joystick />}
      <div className="absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-3 z-20 grid grid-cols-[auto_auto] items-end gap-3">
        <div className="flex flex-col items-center gap-3">
          {act && <ActionButton look={ACT_UI[act]} slot="act" size={70} progress={me.searching} testId={`button-${act}`} />}
          {item && <ActionButton look={item} slot="item" size={64} testId="button-item" />}
        </div>
        <div className="flex flex-col items-center gap-3">
          {b && <ActionButton look={ABILITY_UI[b]} slot="b" size={66} cooldown={me.cdB} cooldownMax={abilityCooldown(b)} testId={`button-${b}`} />}
          {a && <ActionButton look={ABILITY_UI[a]} slot="a" size={90} cooldown={me.cdA} cooldownMax={abilityCooldown(a)} testId={`button-${a}`} />}
        </div>
      </div>
    </>
  );
}
