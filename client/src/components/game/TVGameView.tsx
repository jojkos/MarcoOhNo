import { X } from "lucide-react";
import { useGameStore } from "@/lib/gameStore";
import { backToLobby } from "@/lib/net";
import { GameCanvas } from "./GameCanvas";
import { RoundOver } from "./RoundOver";
import { Avatar, OrbMeter, StatusIcon, formatTime } from "./common";

export function TVGameView() {
  const room = useGameStore((s) => s.room)!;
  const hud = useGameStore((s) => s.hud);
  const round = room.round!;
  const phase = room.phase;
  const phaseLeft = hud?.phaseLeft ?? 0;
  const seeker = room.players.find((p) => p.id === round.seekerId);
  const inRound = new Set(hud?.players.map((p) => p.id));

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      <GameCanvas view="tv" />

      {hud?.danger && phase === "hunt" && (
        <div className="absolute inset-0 pointer-events-none z-10 animate-pulse-fast shadow-[inset_0_0_120px_30px_rgba(255,30,30,0.55)]" />
      )}

      {/* Top HUD */}
      <div className="absolute inset-x-0 top-0 z-20 h-[104px] px-6 py-3 flex items-center justify-between gap-6 bg-gradient-to-b from-black via-black/80 to-transparent">
        <div className="flex flex-wrap gap-2 flex-1 min-w-0">
          {room.players
            .filter((p) => inRound.has(p.id))
            .map((p) => {
              const sp = hud?.players.find((x) => x.id === p.id);
              return (
                <div
                  key={p.id}
                  className={`flex items-center gap-2 px-2 py-1 rounded-md bg-white/5 border border-white/10 ${
                    sp?.status === "ghost" || sp?.status === "caged" ? "opacity-60" : ""
                  }`}
                >
                  <Avatar player={p} size={22} seeker={sp?.role === "seeker"} />
                  <span className="text-sm font-semibold">{p.name}</span>
                  <StatusIcon p={sp} connected={p.connected} />
                </div>
              );
            })}
        </div>

        <div className="text-center shrink-0">
          <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
            {phase === "hunt" ? "Time left" : phase === "scatter" ? "Hide!" : ""}
          </p>
          <p
            className={`font-display text-5xl font-bold tabular-nums ${
              phase === "hunt" && phaseLeft < 20000 ? "text-destructive animate-pulse-fast" : ""
            }`}
            data-testid="text-timer"
          >
            {phase === "hunt" ? formatTime(phaseLeft) : phase === "scatter" ? Math.ceil(phaseLeft / 1000) : ""}
          </p>
        </div>

        <div className="flex-1 flex justify-end">
          <div className="text-right">
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground mb-1">Orbs</p>
            <OrbMeter collected={hud?.collected ?? 0} need={round.orbsToWin} large />
          </div>
        </div>
      </div>

      {phase === "reveal" && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/70 text-center animate-fade-in">
          <p className="text-muted-foreground uppercase tracking-[0.4em] text-xl mb-2">Round {round.id}</p>
          <p className="font-display text-7xl font-bold text-game-seeker mb-3">{seeker?.name ?? "?"}</p>
          <p className="font-display text-3xl tracking-wider mb-8">IS THE SEEKER</p>
          <p className="text-xl text-muted-foreground max-w-2xl">
            Runners: collect <span className="text-yellow-300">{round.orbsToWin} orbs</span> and free your caged friends.
            <br />
            Seeker: catch everyone, or hold them off until time runs out.
          </p>
        </div>
      )}

      {phase === "scatter" && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center text-center pointer-events-none">
          <p className="text-2xl uppercase tracking-[0.4em] text-muted-foreground mb-4">The seeker is counting</p>
          <p className="font-display text-[12rem] leading-none text-game-seeker">{Math.ceil(phaseLeft / 1000)}</p>
          <p className="text-2xl mt-6 text-game-runner">Runners, hide! When the lights go out, this screen shows the seeker's flashlight.</p>
        </div>
      )}

      {phase !== "round_over" && (
        <button
          onClick={backToLobby}
          className="absolute bottom-3 right-3 z-40 flex items-center gap-1 px-2 py-1 rounded text-xs text-white/40 hover:text-white hover:bg-white/10"
          data-testid="button-end-round"
        >
          <X className="w-3 h-3" /> End round
        </button>
      )}

      {phase === "round_over" && <RoundOver tv />}
    </div>
  );
}
