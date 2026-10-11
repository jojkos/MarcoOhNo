import { useEffect, useRef, useState } from "react";
import { Megaphone, Zap, Wind, Ghost, Siren, Cloud, Copy, Sun, Flame, Target, DoorOpen, DoorClosed, Search, type LucideIcon } from "lucide-react";
import { RULES } from "@shared/config";
import { abilityCooldown, abilityFor, type Ability } from "@shared/rules";
import type { ActionSlot } from "@shared/protocol";
import { input, press } from "@/game/input";
import { getRoom } from "@/lib/session";
import type { PlayerView } from "@/lib/gameStore";
import { haptic } from "@/audio/haptics";
import { cn } from "@/lib/utils";

const JOY_RADIUS = 56;
const DEADZONE = 0.12;
/** Deflection (0..1) that gives full speed. */
const FULL_SPEED_AT = 0.5;
/** Speed just outside the deadzone. */
const MIN_SPEED = 0.35;

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

/**
 * Floating joystick: touch anywhere on the left part of the screen.
 * - The base trails your thumb when you drag past the rim, so reversing is instant.
 * - Full speed at about half deflection; a light touch still moves at a decent pace.
 * - Everything moves via style (no React re-render per touch move).
 */
function Joystick() {
  const [active, setActive] = useState(false);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const ring = useRef<HTMLDivElement | null>(null);
  const knob = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);

  const place = () => {
    const o = origin.current;
    if (o && ring.current) ring.current.style.transform = `translate(${o.x - JOY_RADIUS}px, ${o.y - JOY_RADIUS}px)`;
  };

  const update = (clientX: number, clientY: number) => {
    const o = origin.current;
    if (!o) return;
    let dx = clientX - o.x;
    let dy = clientY - o.y;
    let len = Math.hypot(dx, dy);
    if (len > JOY_RADIUS) {
      // Drag the base along so the knob stays on the rim under the thumb.
      const over = len - JOY_RADIUS;
      o.x += (dx / len) * over;
      o.y += (dy / len) * over;
      dx = clientX - o.x;
      dy = clientY - o.y;
      len = JOY_RADIUS;
      place();
    }
    if (knob.current) knob.current.style.transform = `translate(${dx}px, ${dy}px)`;
    const mag = len / JOY_RADIUS;
    if (mag < DEADZONE) {
      input.joyX = 0;
      input.joyY = 0;
      return;
    }
    const k = Math.min(1, (mag - DEADZONE) / (FULL_SPEED_AT - DEADZONE));
    const speed = MIN_SPEED + (1 - MIN_SPEED) * k;
    input.joyX = (dx / len) * speed;
    input.joyY = (dy / len) * speed;
  };

  const end = () => {
    pointer.current = null;
    origin.current = null;
    setActive(false);
    input.joyX = 0;
    input.joyY = 0;
  };

  // Unmounting mid-drag (hiding in a locker, round over) or losing the touch to the OS
  // must never leave the character walking on its own.
  useEffect(() => {
    const onRelease = () => pointer.current !== null && end();
    window.addEventListener("mo:release", onRelease);
    return () => {
      window.removeEventListener("mo:release", onRelease);
      input.joyX = 0;
      input.joyY = 0;
    };
  }, []);

  return (
    <div
      className="absolute bottom-0 left-0 top-16 w-[58%] touch-none select-none"
      onPointerDown={(e) => {
        // A previous touch whose "up" got lost (system gesture) doesn't block new ones.
        if (pointer.current !== null && e.currentTarget.hasPointerCapture(pointer.current)) return;
        pointer.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        origin.current = { x: e.clientX, y: e.clientY };
        setActive(true);
        update(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (e.pointerId !== pointer.current) return;
        update(e.clientX, e.clientY);
      }}
      onPointerUp={(e) => e.pointerId === pointer.current && end()}
      onPointerCancel={(e) => e.pointerId === pointer.current && end()}
      onLostPointerCapture={(e) => e.pointerId === pointer.current && end()}
      data-testid="control-joystick"
    >
      <div
        ref={(el) => {
          ring.current = el;
          place();
        }}
        className={cn(
          "pointer-events-none fixed left-0 top-0 rounded-full border-2 border-neon-cyan/40 bg-neon-cyan/[0.06] shadow-[0_0_30px_-6px_hsl(var(--primary)/0.6)]",
          !active && "hidden",
        )}
        style={{ width: JOY_RADIUS * 2, height: JOY_RADIUS * 2 }}
      >
        <div
          ref={knob}
          className="absolute h-14 w-14 rounded-full bg-[radial-gradient(circle_at_35%_30%,#ffffff,#9fe9ff)] shadow-[0_0_24px_2px_hsl(var(--primary)/0.7)]"
          style={{ left: JOY_RADIUS - 28, top: JOY_RADIUS - 28 }}
        />
      </div>
      {!active && (
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
  // Use where the character is on this screen right now, not the (older) server copy.
  const x = Number.isFinite(input.selfX) ? input.selfX : me.x;
  const y = Number.isFinite(input.selfY) ? input.selfY : me.y;
  let near = false;
  lockers.forEach((l) => {
    if (Math.hypot(l.x - x, l.y - y) <= RULES.lockerRange && !(me.role === "seeker" && l.checked)) near = true;
  });
  if (!near) return null;
  return me.role === "seeker" ? "search" : "hide";
}

export function MobileControls({ me, hunt }: { me: PlayerView; hunt: boolean }) {
  const a = abilityFor(me.role, me.status, "a");
  const b = abilityFor(me.role, me.status, "b");
  const act = hunt ? contextAction(me) : null;
  // Items work only while you're out and about (the server ignores them in cages/lockers).
  const canUseItem = me.locker < 0 && (me.role === "seeker" || me.status === "free");
  const item = me.item && canUseItem ? ITEM_UI[me.item] : undefined;
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
