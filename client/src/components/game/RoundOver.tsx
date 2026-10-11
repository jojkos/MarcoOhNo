import { navigate } from "wouter/use-browser-location";
import { Trophy, Skull, Ban, RotateCcw, Users, LogOut, Flashlight, Sparkles, HeartHandshake, Lock, Ghost, Medal } from "lucide-react";
import { useGameStore } from "@/lib/gameStore";
import { leaveSeat, send } from "@/lib/session";
import { Btn } from "@/components/kit";
import { cn } from "@/lib/utils";
import { Blob } from "./Blob";

const MEDAL = ["text-neon-gold", "text-slate-300", "text-amber-600"];

export function RoundOver({ tv }: { tv: boolean }) {
  const view = useGameStore((s) => s.view)!;
  const playerId = useGameStore((s) => s.playerId);
  const isHostScreen = useGameStore((s) => s.attachment?.isHost ?? false);
  const result = view.result;
  if (!result) return null;

  const canControl = (tv && isHostScreen) || view.vipId === playerId;
  const seekerWon = result.winner === "seeker";
  const aborted = result.winner === "aborted";
  const title = aborted ? "Round cancelled" : seekerWon ? "Seeker wins!" : "Runners win!";
  const tone = aborted ? "text-muted-foreground" : seekerWon ? "text-neon-red glow-text-red" : "text-neon-mint glow-text-mint";
  const Icon = aborted ? Ban : seekerWon ? Skull : Trophy;
  const wash = aborted ? "from-white/5" : seekerWon ? "from-neon-red/25" : "from-neon-mint/25";

  const mine = result.players.find((p) => p.id === playerId);
  const iWon = mine && !aborted && (mine.role === "seeker") === seekerWon;
  const byId = new Map(view.players.map((p) => [p.id, p]));

  const rows = view.players.map((lp) => ({ lp, r: result.players.find((p) => p.id === lp.id) })).sort((a, b) => b.lp.score - a.lp.score);

  return (
    <div className="absolute inset-0 z-40 overflow-y-auto bg-background/80 backdrop-blur-md animate-fade-in">
      <div className={cn("pointer-events-none absolute inset-x-0 top-0 h-[60%] bg-gradient-to-b to-transparent", wash)} />
      <div className={cn("relative mx-auto flex min-h-full flex-col justify-center gap-5 safe-pad", tv ? "max-w-4xl py-8" : "max-w-md")}>
        <div className="animate-rise-in text-center">
          <Icon className={cn("mx-auto mb-2", tv ? "h-16 w-16" : "h-12 w-12", tone)} />
          <h1 className={cn("font-display font-bold uppercase tracking-wide", tv ? "text-7xl" : "text-4xl", tone)} data-testid="text-winner">
            {title}
          </h1>
          <p className={cn("mt-2 text-muted-foreground", tv && "text-xl")}>{result.reason}</p>
          {mine && !aborted && (
            <div className={cn("mt-4 inline-flex items-center gap-2 rounded-full px-5 py-2 font-display text-xl font-bold", iWon ? "bg-neon-mint/15 text-neon-mint" : "bg-white/5 text-muted-foreground")}>
              {iWon ? "You won!" : "You lost"} <span className="text-neon-gold">+{mine.points}</span>
            </div>
          )}
        </div>

        {result.awards.length > 0 && (
          <div className={cn("grid gap-3 animate-rise-in [animation-delay:80ms]", tv ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2")}>
            {result.awards.map((a) => {
              const p = byId.get(a.id);
              return (
                <div key={a.title} className="glass flex flex-col items-center gap-1.5 rounded-2xl p-3 text-center">
                  <Medal className="h-5 w-5 text-neon-gold" />
                  <p className="font-display text-xs font-bold uppercase tracking-widest text-neon-gold">{a.title}</p>
                  {p && <Blob color={p.color} face={p.face} size={tv ? 44 : 34} seeker={p.role === "seeker"} />}
                  <p className="font-semibold">{p?.name ?? "?"}</p>
                  <p className="text-xs text-muted-foreground">{a.detail}</p>
                </div>
              );
            })}
          </div>
        )}

        <div className="glass-strong animate-rise-in overflow-hidden rounded-3xl [animation-delay:140ms]">
          {rows.map(({ lp, r }, i) => (
            <div key={lp.id} className={cn("flex items-center gap-3 px-4", tv ? "py-3" : "py-2.5", i > 0 && "border-t border-white/5", lp.id === playerId && "bg-white/[0.04]")}>
              <span className={cn("w-6 text-center font-display font-bold", MEDAL[i] ?? "text-muted-foreground", tv && "text-xl")}>{i + 1}</span>
              <Blob color={lp.color} face={lp.face} size={tv ? 40 : 30} seeker={r?.role === "seeker"} glow={false} />
              <span className={cn("min-w-0 flex-1 truncate font-semibold", tv && "text-xl")}>{lp.name}</span>
              {r && (
                <span className="flex items-center gap-2.5 text-sm text-muted-foreground">
                  {r.role === "seeker" ? (
                    <span className="flex items-center gap-1" title="Catches">
                      <Flashlight className="h-4 w-4 text-neon-red" />
                      {r.catches}
                    </span>
                  ) : (
                    <>
                      <span className="flex items-center gap-1" title="Orbs">
                        <Sparkles className="h-4 w-4 text-neon-gold" />
                        {r.orbs}
                      </span>
                      <span className="flex items-center gap-1" title="Rescues">
                        <HeartHandshake className="h-4 w-4 text-neon-mint" />
                        {r.rescues}
                      </span>
                      {r.status === "caged" && <Lock className="h-4 w-4 text-neon-orange" />}
                      {r.status === "ghost" && <Ghost className="h-4 w-4" />}
                    </>
                  )}
                  <span className="w-8 text-right font-display font-bold text-neon-gold">+{r.points}</span>
                </span>
              )}
              <span className={cn("w-10 text-right font-display font-bold", tv ? "text-3xl" : "text-xl")}>{lp.score}</span>
            </div>
          ))}
        </div>

        <div className="flex animate-rise-in flex-col items-center gap-3 [animation-delay:200ms] sm:flex-row sm:justify-center">
          {canControl ? (
            <>
              <Btn tone="cyan" size={tv ? "xl" : "lg"} icon={RotateCcw} onClick={() => send.start()} block={!tv} data-testid="button-next-round">
                Next round
              </Btn>
              <Btn tone="ghost" size={tv ? "lg" : "md"} icon={Users} onClick={() => send.toLobby()} block={!tv} data-testid="button-lobby">
                Lobby
              </Btn>
            </>
          ) : (
            <p className="animate-pulse text-center text-muted-foreground">Waiting for the host…</p>
          )}
          {!tv && (
            <button
              onClick={() => {
                leaveSeat();
                navigate("/", { replace: true });
              }}
              className="inline-flex items-center gap-2 py-2 text-sm text-muted-foreground hover:text-neon-red"
              data-testid="button-leave"
            >
              <LogOut className="h-4 w-4" /> Leave room
            </button>
          )}
        </div>
        {tv && <p className="text-center text-sm text-muted-foreground">Next round, a different player becomes the seeker.</p>}
      </div>
    </div>
  );
}
