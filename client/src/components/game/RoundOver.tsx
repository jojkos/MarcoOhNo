import { Button } from "@/components/ui/button";
import { Trophy, Skull, Ban, RotateCcw, Home, LogOut, Flashlight, Sparkles, Lock, HeartHandshake } from "lucide-react";
import { useGameStore } from "@/lib/gameStore";
import { backToLobby, leaveGame, startRound } from "@/lib/net";
import { Avatar } from "./common";

export function RoundOver({ tv }: { tv: boolean }) {
  const room = useGameStore((s) => s.room)!;
  const playerId = useGameStore((s) => s.playerId);
  const result = room.result;
  if (!result) return null;

  const canControl = tv || room.vipId === playerId;
  const title =
    result.winner === "seeker" ? "SEEKER WINS!" : result.winner === "runners" ? "RUNNERS WIN!" : "ROUND CANCELLED";
  const color =
    result.winner === "seeker" ? "text-game-seeker" : result.winner === "runners" ? "text-game-runner" : "text-muted-foreground";
  const Icon = result.winner === "seeker" ? Skull : result.winner === "runners" ? Trophy : Ban;

  const mine = result.players.find((p) => p.id === playerId);
  const iWon = mine && result.winner !== "aborted" && (mine.role === "seeker") === (result.winner === "seeker");

  const rows = room.players
    .map((lp) => ({ lp, r: result.players.find((p) => p.id === lp.id) }))
    .sort((a, b) => b.lp.score - a.lp.score);

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className={`w-full ${tv ? "max-w-3xl p-8" : "max-w-md p-4"} space-y-5`}>
        <div className="text-center">
          <Icon className={`mx-auto mb-2 ${tv ? "w-20 h-20" : "w-14 h-14"} ${color}`} />
          <h1 className={`font-display font-bold tracking-wider ${tv ? "text-6xl" : "text-4xl"} ${color}`} data-testid="text-winner">
            {title}
          </h1>
          <p className="text-muted-foreground text-lg mt-1">{result.reason}</p>
          {mine && result.winner !== "aborted" && (
            <p className="text-2xl font-display mt-2">
              {iWon ? "You won! " : "You lost. "}
              <span className="text-yellow-300">+{mine.points}</span>
            </p>
          )}
        </div>

        <div className="rounded-lg border border-white/10 overflow-hidden">
          {rows.map(({ lp, r }, i) => (
            <div key={lp.id} className={`flex items-center gap-3 px-3 py-2 ${i % 2 ? "bg-white/5" : ""}`}>
              <span className="w-5 text-muted-foreground font-display">{i + 1}</span>
              <Avatar player={lp} size={tv ? 36 : 28} seeker={r?.role === "seeker"} />
              <span className={`flex-1 truncate font-semibold ${tv ? "text-xl" : ""}`}>{lp.name}</span>
              {r && (
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  {r.role === "seeker" ? (
                    <span className="flex items-center gap-1">
                      <Flashlight className="w-4 h-4 text-game-seeker" />
                      {r.catches}
                    </span>
                  ) : (
                    <>
                      <span className="flex items-center gap-1">
                        <Sparkles className="w-4 h-4 text-yellow-300" />
                        {r.orbs}
                      </span>
                      <span className="flex items-center gap-1">
                        <HeartHandshake className="w-4 h-4 text-game-runner" />
                        {r.rescues}
                      </span>
                      {r.status !== "free" && <Lock className="w-4 h-4" />}
                    </>
                  )}
                  <span className="text-yellow-300 w-8 text-right">+{r.points}</span>
                </span>
              )}
              <span className={`font-display w-10 text-right ${tv ? "text-2xl" : "text-lg"}`}>{lp.score}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          {canControl ? (
            <>
              <Button size="lg" onClick={startRound} className="font-display tracking-wider py-6" data-testid="button-next-round">
                <RotateCcw className="w-5 h-5 mr-2" />
                NEXT ROUND
              </Button>
              <Button size="lg" variant="outline" onClick={backToLobby} className="font-display tracking-wider py-6" data-testid="button-lobby">
                <Home className="w-5 h-5 mr-2" />
                LOBBY
              </Button>
            </>
          ) : (
            <p className="text-center text-muted-foreground animate-pulse">Waiting for the host…</p>
          )}
          {!tv && (
            <Button size="lg" variant="ghost" onClick={leaveGame} data-testid="button-leave">
              <LogOut className="w-5 h-5 mr-2" />
              Leave
            </Button>
          )}
        </div>
        {tv && <p className="text-center text-sm text-muted-foreground">The seeker role rotates each round.</p>}
      </div>
    </div>
  );
}
