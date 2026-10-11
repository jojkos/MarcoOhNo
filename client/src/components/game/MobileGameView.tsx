import { useEffect, useRef, useState, type ReactNode } from "react";
import { Lock, Ghost, ShieldCheck, WifiOff, EyeOff, DoorClosed, Siren, Target, Sun } from "lucide-react";
import { RULES } from "@shared/config";
import { useGameStore, useMe, type PlayerView } from "@/lib/gameStore";
import { onFx } from "@/lib/session";
import { cn } from "@/lib/utils";
import { GameCanvas } from "./GameCanvas";
import { MobileControls } from "./MobileControls";
import { RoleReveal } from "./RoleReveal";
import { RoundOver } from "./RoundOver";
import { OrbMeter, formatTime } from "./common";

/** Keep the phone awake during a round; a sleeping phone drops its connection. */
function useWakeLock() {
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null;
    const request = () => {
      (navigator as any).wakeLock
        ?.request("screen")
        .then((l: typeof lock) => (lock = l))
        .catch(() => {});
    };
    request();
    const onVisible = () => document.visibilityState === "visible" && request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release().catch(() => {});
    };
  }, []);
}

const BANNER_TONES = {
  info: "border-neon-cyan/40 shadow-[0_0_40px_-12px_hsl(var(--primary)/0.6)]",
  danger: "border-neon-red/50 shadow-[0_0_40px_-12px_hsl(var(--seeker)/0.7)]",
  cage: "border-neon-orange/50 shadow-[0_0_40px_-12px_hsl(var(--cage)/0.7)]",
  ghost: "border-white/20",
};

function Banner({ children, tone }: { children: ReactNode; tone: keyof typeof BANNER_TONES }) {
  return (
    <div className={cn("glass-strong pointer-events-none absolute left-3 right-3 top-[60px] z-30 rounded-2xl border px-4 py-3 text-center animate-rise-in", BANNER_TONES[tone])}>
      {children}
    </div>
  );
}

/** Arrows pointing to caged teammates who pressed HELP. */
function HelpArrows({ me }: { me: PlayerView }) {
  const [calls, setCalls] = useState<{ id: string; x: number; y: number; until: number }[]>([]);
  useEffect(
    () =>
      onFx((events) => {
        const now = performance.now();
        const fresh = events.filter((e): e is Extract<typeof e, { k: "help" }> => e.k === "help" && e.id !== me.id);
        if (fresh.length) setCalls((c) => [...c.filter((x) => x.until > now && !fresh.some((f) => f.id === x.id)), ...fresh.map((f) => ({ id: f.id, x: f.x, y: f.y, until: now + 6000 }))]);
      }),
    [me.id],
  );
  useEffect(() => {
    if (!calls.length) return;
    const t = setInterval(() => setCalls((c) => c.filter((x) => x.until > performance.now())), 500);
    return () => clearInterval(t);
  }, [calls.length]);
  if (me.role !== "runner" || me.status !== "free") return null;
  return (
    <>
      {calls.map((c) => {
        const a = Math.atan2(c.y - me.y, c.x - me.x);
        const d = Math.round(Math.hypot(c.y - me.y, c.x - me.x) / 10);
        return (
          <div key={c.id} className="pointer-events-none absolute left-1/2 top-1/2 z-20" style={{ transform: `translate(-50%,-50%) rotate(${a}rad) translateX(130px)` }}>
            <div className="flex items-center gap-1 rounded-full bg-neon-mint px-2 py-1 font-display text-xs font-bold text-black shadow-[0_0_20px_hsl(var(--runner))]" style={{ transform: `rotate(${-a}rad)` }}>
              <Siren className="h-3.5 w-3.5" /> {d}m
            </div>
          </div>
        );
      })}
    </>
  );
}

function useHideTimer(locker: number | undefined) {
  const since = useRef<number | null>(null);
  const [, force] = useState(0);
  useEffect(() => {
    since.current = locker !== undefined && locker >= 0 ? performance.now() : null;
    if (since.current === null) return;
    const t = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [locker]);
  return since.current === null ? 0 : Math.max(0, RULES.lockerMaxHideMs - (performance.now() - since.current));
}

export function MobileGameView() {
  useWakeLock();
  const view = useGameStore((s) => s.view)!;
  const status = useGameStore((s) => s.attachment?.status);
  const me = useMe();
  const hideLeft = useHideTimer(me?.locker);
  const round = view.round;
  const phase = view.phase;
  if (!round) return null;
  const seekerName = view.players.find((p) => p.id === round.seekerId)?.name ?? "The seeker";

  if (phase !== "round_over" && (!me || !me.inRound)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <EyeOff className="h-10 w-10 text-muted-foreground" />
        <p className="font-display text-xl font-bold">Sitting this round out</p>
        <p className="text-muted-foreground">Watch the TV. You'll be in the next round.</p>
      </div>
    );
  }

  const isSeeker = me?.role === "seeker";
  const exposure = me?.status === "free" ? me.exposure : 0;
  const hunt = phase === "hunt";
  const roleTag = isSeeker
    ? { label: "Seeker", cls: "bg-neon-red text-white" }
    : me?.status === "ghost"
      ? { label: "Ghost", cls: "bg-white/20 text-white" }
      : me?.status === "caged"
        ? { label: "Caged", cls: "bg-neon-orange text-black" }
        : { label: "Runner", cls: "bg-neon-mint text-black" };
  const online = status !== "reconnecting";

  return (
    <div className="relative h-full w-full select-none overflow-hidden bg-black">
      <GameCanvas view="mobile" />

      <div
        className="pointer-events-none absolute inset-0 z-10 transition-[box-shadow] duration-100"
        style={{ boxShadow: `inset 0 0 ${60 + exposure * 120}px ${exposure * 40}px rgba(255,40,70,${exposure * 0.9})` }}
      />

      {phase !== "round_over" && (
        <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 bg-gradient-to-b from-black/90 to-transparent px-3 pb-6 pt-[max(0.6rem,env(safe-area-inset-top))]">
          <span className={cn("rounded-lg px-2.5 py-1 font-display text-xs font-bold uppercase tracking-wider", roleTag.cls)}>{roleTag.label}</span>
          <span className={cn("font-display text-3xl font-bold tabular-nums", hunt && view.phaseLeft < 20000 && "animate-pulse-fast text-neon-red glow-text-red")}>
            {hunt ? formatTime(view.phaseLeft) : phase === "scatter" ? Math.ceil(view.phaseLeft / 1000) : ""}
          </span>
          <OrbMeter collected={view.collected} need={round.orbsToWin} />
        </div>
      )}

      {!online && (
        <Banner tone="danger">
          <span className="flex items-center justify-center gap-2 font-display font-bold">
            <WifiOff className="h-4 w-4" /> Reconnecting…
          </span>
        </Banner>
      )}

      {online && me && (
        <>
          {phase === "scatter" && !isSeeker && (
            <Banner tone="info">
              <p className="font-display text-lg font-bold uppercase">Hide! Lights out in {Math.ceil(view.phaseLeft / 1000)}</p>
              <p className="text-sm text-muted-foreground">Stand on a glowing orb to charge it. Blue cabinets are lockers you can hide in.</p>
            </Banner>
          )}
          {hunt && me.status === "caged" && (
            <Banner tone="cage">
              <p className="flex items-center justify-center gap-2 font-display text-lg font-bold uppercase text-neon-orange">
                <Lock className="h-5 w-5" /> Caged
              </p>
              <p className="text-sm text-muted-foreground">
                Press HELP! A teammate next to you frees you fast; alone you slowly pick the lock{me.rescue > 0 ? ` (${Math.round(me.rescue * 100)}%)` : ""}. Another catch makes you a ghost.
              </p>
            </Banner>
          )}
          {hunt && me.status === "ghost" && (
            <Banner tone="ghost">
              <p className="flex items-center justify-center gap-2 font-display text-lg font-bold uppercase">
                <Ghost className="h-5 w-5" /> You're a ghost
              </p>
              <p className="text-sm text-muted-foreground">Float through walls. BOO fakes a noise on the seeker's screen.</p>
            </Banner>
          )}
          {hunt && me.locker >= 0 && (
            <Banner tone="info">
              <p className="flex items-center justify-center gap-2 font-display text-lg font-bold uppercase text-neon-cyan">
                <DoorClosed className="h-5 w-5" /> Hiding · {Math.ceil(hideLeft / 1000)}s
              </p>
              <p className="text-sm text-muted-foreground">The beam can't see you, but the seeker can search lockers.</p>
            </Banner>
          )}
          {hunt && me.rooted && (
            <Banner tone="danger">
              <p className="flex items-center justify-center gap-2 font-display text-lg font-bold uppercase text-neon-red">
                <Target className="h-5 w-5" /> Trapped!
              </p>
            </Banner>
          )}
          {hunt && me.blinded && (
            <Banner tone="danger">
              <p className="flex items-center justify-center gap-2 font-display text-lg font-bold uppercase">
                <Sun className="h-5 w-5" /> Blinded!
              </p>
            </Banner>
          )}
          {hunt && me.invuln && (
            <Banner tone="info">
              <span className="flex items-center justify-center gap-2 font-display font-bold uppercase text-neon-cyan">
                <ShieldCheck className="h-5 w-5" /> Free! Shielded for a moment
              </span>
            </Banner>
          )}
          {hunt && <HelpArrows me={me} />}
        </>
      )}

      {phase === "scatter" && isSeeker && (
        <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/85 p-6 text-center">
          <p className="mb-2 font-display text-sm font-bold uppercase tracking-[0.35em] text-muted-foreground">Eyes closed · counting</p>
          <p className="font-display text-[9rem] font-bold leading-none text-neon-red glow-text-red">{Math.ceil(view.phaseLeft / 1000)}</p>
          <p className="mt-4 text-muted-foreground">No peeking at the TV!</p>
        </div>
      )}

      {me && (phase === "scatter" || hunt) && <MobileControls me={me} hunt={hunt} />}
      {phase === "reveal" && me && <RoleReveal role={me.role} seekerName={seekerName} orbs={round.orbsToWin} />}
      {phase === "round_over" && <RoundOver tv={false} />}
    </div>
  );
}
