import { X } from "lucide-react";
import { useGameStore } from "@/lib/gameStore";
import { send } from "@/lib/session";
import { cn } from "@/lib/utils";
import { GameCanvas } from "./GameCanvas";
import { RoundOver } from "./RoundOver";
import { Blob } from "./Blob";
import { SoundToggle } from "./SoundToggle";
import { OrbMeter, StatusIcon, formatTime } from "./common";

export function TVGameView() {
  const view = useGameStore((s) => s.view)!;
  const isHost = useGameStore((s) => s.attachment?.isHost ?? false);
  const round = view.round;
  if (!round) return null;
  const phase = view.phase;
  const seeker = view.players.find((p) => p.id === round.seekerId);
  const lowTime = phase === "hunt" && view.phaseLeft < 20000;

  const inRound = view.players.filter((p) => p.inRound);
  const compact = inRound.length > 5;
  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <GameCanvas view="tv" />

      {view.danger && phase === "hunt" && (
        <div className="pointer-events-none absolute inset-0 z-10 animate-pulse-fast shadow-[inset_0_0_140px_30px_rgba(255,40,70,0.5)]" />
      )}

      <div className="absolute inset-x-0 top-0 z-20 flex h-[104px] items-center justify-between gap-6 bg-gradient-to-b from-black via-black/85 to-transparent px-6 pb-3">
        {/* Many players: compact chips (face + status) so the bar never grows past the HUD height. */}
        <div className="flex max-h-[92px] min-w-0 flex-1 flex-wrap content-center gap-2 overflow-hidden">
          {inRound.map((p) => (
              <div key={p.id} title={p.name} className={cn("glass flex items-center gap-2 rounded-full py-1 pl-1", compact ? "pr-2" : "pr-3", (p.status === "ghost" || p.status === "caged") && "opacity-55")}>
                <Blob color={p.color} face={p.face} size={28} seeker={p.role === "seeker"} glow={false} dim={!p.connected} />
                {!compact && <span className="max-w-[9rem] truncate text-sm font-semibold">{p.name}</span>}
                <StatusIcon p={p} connected={p.connected} />
              </div>
            ))}
        </div>

        <div className="shrink-0 text-center">
          <p className="font-display text-xs font-bold uppercase tracking-[0.35em] text-muted-foreground">
            {phase === "hunt" ? "Time left" : phase === "scatter" ? "Hide!" : `Round ${round.id}`}
          </p>
          <p className={cn("font-display text-6xl font-bold leading-none tabular-nums", lowTime ? "animate-pulse-fast text-neon-red glow-text-red" : "glow-text-cyan")} data-testid="text-timer">
            {phase === "hunt" ? formatTime(view.phaseLeft) : phase === "scatter" ? Math.ceil(view.phaseLeft / 1000) : "–"}
          </p>
        </div>

        <div className="flex flex-1 items-start justify-end gap-3">
          <div className="text-right">
            <p className="mb-1.5 font-display text-xs font-bold uppercase tracking-[0.35em] text-muted-foreground">Orbs</p>
            <OrbMeter collected={view.collected} need={round.orbsToWin} large />
          </div>
          <SoundToggle className="mt-1" />
        </div>
      </div>

      {phase === "reveal" && (
        <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center bg-[radial-gradient(ellipse_at_center,hsl(351_80%_14%/0.75),rgb(0_0_0/0.55)_70%)] text-center animate-fade-in">
          <p className="animate-rise-in font-display text-xl font-bold uppercase tracking-[0.5em] text-muted-foreground">Round {round.id}</p>
          <div className="my-6 animate-pop-in">{seeker && <Blob color={seeker.color} face={seeker.face} size={130} seeker />}</div>
          <p className="animate-rise-in font-display text-8xl font-bold text-neon-red glow-text-red [animation-delay:100ms]">{seeker?.name ?? "?"}</p>
          <p className="mt-2 animate-rise-in font-display text-3xl font-bold uppercase tracking-[0.3em] [animation-delay:180ms]">is the seeker</p>
          <p className="mt-10 max-w-2xl animate-rise-in text-xl leading-relaxed text-muted-foreground [animation-delay:260ms]">
            Runners: charge <span className="font-bold text-neon-gold">{round.orbsToWin} orbs</span>, hide in lockers, free caged friends.
            <br />
            Seeker: catch everyone, or hold them off until time runs out.
          </p>
        </div>
      )}

      {phase === "scatter" && (
        <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center text-center">
          <p className="font-display text-2xl font-bold uppercase tracking-[0.45em] text-muted-foreground">The seeker is counting</p>
          <p className="font-display text-[14rem] font-bold leading-none text-neon-red glow-text-red">{Math.ceil(view.phaseLeft / 1000)}</p>
          <p className="mt-4 text-2xl text-neon-mint glow-text-mint">Runners, hide! When the lights go out, this screen shows the flashlight.</p>
        </div>
      )}

      {phase !== "round_over" && isHost && (
        <button
          onClick={() => send.toLobby()}
          className="absolute bottom-3 right-3 z-40 flex items-center gap-1 rounded-full px-3 py-1.5 text-xs text-white/35 transition hover:bg-white/10 hover:text-white"
          data-testid="button-end-round"
        >
          <X className="h-3 w-3" /> End round
        </button>
      )}

      {phase === "round_over" && <RoundOver tv />}
    </div>
  );
}
