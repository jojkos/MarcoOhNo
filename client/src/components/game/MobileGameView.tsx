import { useEffect } from "react";
import { Lock, Ghost, ShieldCheck, WifiOff } from "lucide-react";
import { useGameStore } from "@/lib/gameStore";
import { GameCanvas } from "./GameCanvas";
import { MobileControls } from "./MobileControls";
import { RoleReveal } from "./RoleReveal";
import { RoundOver } from "./RoundOver";
import { OrbMeter, formatTime } from "./common";

function Banner({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "danger" | "info" }) {
  const tones = {
    default: "bg-black/70 border-white/15",
    danger: "bg-red-950/80 border-red-500/50",
    info: "bg-sky-950/80 border-sky-400/40",
  };
  return (
    <div className={`absolute left-3 right-3 top-16 z-30 rounded-lg border px-4 py-3 text-center pointer-events-none ${tones[tone]}`}>
      {children}
    </div>
  );
}

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
      <div className="h-full flex items-center justify-center p-6 text-center text-muted-foreground">
        You're sitting this round out. Watch the TV, and you'll be in the next round.
      </div>
    );
  }

  const isSeeker = me?.role === "seeker";
  const phaseLeft = hud?.phaseLeft ?? 0;
  const exposure = me?.status === "free" ? me.exposure : 0;
  const threat = hud?.threat ?? 0;

  return (
    <div className="relative w-full h-full bg-black overflow-hidden select-none">
      <GameCanvas view="mobile" />

      {/* Danger vignette: being lit, or the seeker is close */}
      <div
        className="absolute inset-0 pointer-events-none z-10 transition-[box-shadow] duration-100"
        style={{
          boxShadow: `inset 0 0 ${60 + exposure * 120}px ${exposure * 40}px rgba(255,40,40,${Math.max(exposure * 0.9, threat * 0.25)})`,
        }}
      />

      {/* Top bar */}
      {phase !== "round_over" && <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 p-2 bg-gradient-to-b from-black/80 to-transparent">
        <span
          className={`px-2 py-1 rounded text-xs font-display tracking-wider ${
            isSeeker ? "bg-game-seeker text-white" : me?.status === "ghost" ? "bg-slate-500" : me?.status === "caged" ? "bg-orange-600" : "bg-game-runner text-black"
          }`}
        >
          {isSeeker ? "SEEKER" : me?.status === "ghost" ? "GHOST" : me?.status === "caged" ? "CAGED" : "RUNNER"}
        </span>
        <span className={`font-display text-2xl tabular-nums ${phase === "hunt" && phaseLeft < 20000 ? "text-destructive animate-pulse-fast" : ""}`}>
          {phase === "hunt" ? formatTime(phaseLeft) : phase === "scatter" ? Math.ceil(phaseLeft / 1000) : ""}
        </span>
        <OrbMeter collected={hud?.collected ?? 0} need={round.orbsToWin} />
      </div>}

      {!connected && (
        <Banner tone="danger">
          <span className="flex items-center justify-center gap-2">
            <WifiOff className="w-4 h-4" /> Reconnecting…
          </span>
        </Banner>
      )}

      {connected && phase === "scatter" && !isSeeker && (
        <Banner tone="info">
          <p className="font-display text-lg">HIDE! Lights out in {Math.ceil(phaseLeft / 1000)}</p>
          <p className="text-sm text-sky-200/80">Learn the maze while you can see it. The glowing dots are orbs.</p>
        </Banner>
      )}

      {connected && phase === "hunt" && me?.status === "caged" && (
        <Banner tone="danger">
          <p className="font-display text-lg flex items-center justify-center gap-2">
            <Lock className="w-5 h-5" /> CAGED
          </p>
          <p className="text-sm text-red-100/80">
            Shout for help! A teammate standing next to you frees you{me.rescue > 0 ? ` (${Math.round(me.rescue * 100)}%)` : ""}.
            Another catch makes you a ghost.
          </p>
        </Banner>
      )}

      {connected && phase === "hunt" && me?.status === "ghost" && (
        <Banner>
          <p className="font-display text-lg flex items-center justify-center gap-2">
            <Ghost className="w-5 h-5" /> YOU'RE A GHOST
          </p>
          <p className="text-sm text-muted-foreground">Float through walls. BOO makes a fake noise on the seeker's screen.</p>
        </Banner>
      )}

      {connected && phase === "hunt" && me?.invuln && (
        <Banner tone="info">
          <span className="flex items-center justify-center gap-2 font-display">
            <ShieldCheck className="w-5 h-5" /> FREE! Shielded for a moment
          </span>
        </Banner>
      )}

      {phase === "scatter" && isSeeker && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/85 text-center p-6 pointer-events-none">
          <p className="text-muted-foreground uppercase tracking-[0.3em] mb-2">Close your eyes, you're counting</p>
          <p className="font-display text-8xl text-game-seeker">{Math.ceil(phaseLeft / 1000)}</p>
          <p className="text-muted-foreground mt-4">No peeking at the TV!</p>
        </div>
      )}

      {me && (phase === "scatter" || phase === "hunt") && <MobileControls me={me} />}

      {phase === "reveal" && me && <RoleReveal role={me.role} seekerName={seekerName} orbs={round.orbsToWin} />}
      {phase === "round_over" && <RoundOver tv={false} />}
    </div>
  );
}
