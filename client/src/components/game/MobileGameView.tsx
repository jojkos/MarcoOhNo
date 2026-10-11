import { useEffect, type ReactNode } from "react";
import { Lock, Ghost, ShieldCheck, WifiOff, EyeOff } from "lucide-react";
import { useGameStore } from "@/lib/gameStore";
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
    <div className={cn("glass-strong absolute left-3 right-3 top-[60px] z-30 rounded-2xl border px-4 py-3 text-center pointer-events-none animate-rise-in", BANNER_TONES[tone])}>
      {children}
    </div>
  );
}

export function MobileGameView() {
  useWakeLock();
  const room = useGameStore((s) => s.room)!;
  const hud = useGameStore((s) => s.hud);
  const connected = useGameStore((s) => s.connected);
  const round = room.round!;
  const me = hud?.me ?? null;
  const phase = room.phase;
  const seekerName = room.players.find((p) => p.id === round.seekerId)?.name ?? "The seeker";

  if (phase !== "round_over" && !me) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <EyeOff className="h-10 w-10 text-muted-foreground" />
        <p className="font-display text-xl font-bold">Sitting this round out</p>
        <p className="text-muted-foreground">Watch the TV. You'll be in the next round.</p>
      </div>
    );
  }

  const isSeeker = me?.role === "seeker";
  const phaseLeft = hud?.phaseLeft ?? 0;
  const exposure = me?.status === "free" ? me.exposure : 0;
  const threat = hud?.threat ?? 0;
  const roleTag = isSeeker
    ? { label: "Seeker", cls: "bg-neon-red text-white" }
    : me?.status === "ghost"
      ? { label: "Ghost", cls: "bg-white/20 text-white" }
      : me?.status === "caged"
        ? { label: "Caged", cls: "bg-neon-orange text-black" }
        : { label: "Runner", cls: "bg-neon-mint text-black" };

  return (
    <div className="relative h-full w-full select-none overflow-hidden bg-black">
      <GameCanvas view="mobile" />

      {/* Danger vignette: being lit, or the seeker is close */}
      <div
        className="pointer-events-none absolute inset-0 z-10 transition-[box-shadow] duration-100"
        style={{
          boxShadow: `inset 0 0 ${60 + exposure * 120}px ${exposure * 40}px rgba(255,40,70,${Math.max(exposure * 0.9, threat * 0.25)})`,
        }}
      />

      {phase !== "round_over" && (
        <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 bg-gradient-to-b from-black/90 to-transparent px-3 pb-6 pt-[max(0.6rem,env(safe-area-inset-top))]">
          <span className={cn("rounded-lg px-2.5 py-1 font-display text-xs font-bold uppercase tracking-wider", roleTag.cls)}>{roleTag.label}</span>
          <span
            className={cn(
              "font-display text-3xl font-bold tabular-nums",
              phase === "hunt" && phaseLeft < 20000 ? "text-neon-red glow-text-red animate-pulse-fast" : "",
            )}
          >
            {phase === "hunt" ? formatTime(phaseLeft) : phase === "scatter" ? Math.ceil(phaseLeft / 1000) : ""}
          </span>
          <OrbMeter collected={hud?.collected ?? 0} need={round.orbsToWin} />
        </div>
      )}

      {!connected && (
        <Banner tone="danger">
          <span className="flex items-center justify-center gap-2 font-display font-bold">
            <WifiOff className="h-4 w-4" /> Reconnecting…
          </span>
        </Banner>
      )}

      {connected && phase === "scatter" && !isSeeker && (
        <Banner tone="info">
          <p className="font-display text-lg font-bold uppercase">Hide! Lights out in {Math.ceil(phaseLeft / 1000)}</p>
          <p className="text-sm text-muted-foreground">Learn the maze while you can see it. Glowing dots are orbs.</p>
        </Banner>
      )}

      {connected && phase === "hunt" && me?.status === "caged" && (
        <Banner tone="cage">
          <p className="flex items-center justify-center gap-2 font-display text-lg font-bold uppercase text-neon-orange">
            <Lock className="h-5 w-5" /> Caged
          </p>
          <p className="text-sm text-muted-foreground">
            Shout for help! A teammate standing next to you frees you
            {me.rescue > 0 ? ` (${Math.round(me.rescue * 100)}%)` : ""}. Another catch makes you a ghost.
          </p>
        </Banner>
      )}

      {connected && phase === "hunt" && me?.status === "ghost" && (
        <Banner tone="ghost">
          <p className="flex items-center justify-center gap-2 font-display text-lg font-bold uppercase">
            <Ghost className="h-5 w-5" /> You're a ghost
          </p>
          <p className="text-sm text-muted-foreground">Float through walls. BOO puts a fake noise on the seeker's screen.</p>
        </Banner>
      )}

      {connected && phase === "hunt" && me?.invuln && (
        <Banner tone="info">
          <span className="flex items-center justify-center gap-2 font-display font-bold uppercase text-neon-cyan">
            <ShieldCheck className="h-5 w-5" /> Free! Shielded for a moment
          </span>
        </Banner>
      )}

      {phase === "scatter" && isSeeker && (
        <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/85 p-6 text-center">
          <p className="mb-2 font-display text-sm font-bold uppercase tracking-[0.35em] text-muted-foreground">Eyes closed · counting</p>
          <p className="font-display text-[9rem] font-bold leading-none text-neon-red glow-text-red">{Math.ceil(phaseLeft / 1000)}</p>
          <p className="mt-4 text-muted-foreground">No peeking at the TV!</p>
        </div>
      )}

      {me && (phase === "scatter" || phase === "hunt") && <MobileControls me={me} />}

      {phase === "reveal" && me && <RoleReveal role={me.role} seekerName={seekerName} orbs={round.orbsToWin} />}
      {phase === "round_over" && <RoundOver tv={false} />}
    </div>
  );
}
