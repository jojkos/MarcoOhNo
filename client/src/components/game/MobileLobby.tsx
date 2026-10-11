import { navigate } from "wouter/use-browser-location";
import { Play, Trophy, Crown, LogOut, Home, ChevronDown, WifiOff } from "lucide-react";
import { useGameStore } from "@/lib/gameStore";
import { leaveSeat, startRound } from "@/lib/net";
import { RULES } from "@shared/config";
import { Avatar, Btn, Chip, Panel, Screen } from "@/components/kit";
import { HowToPlay } from "./common";

export function MobileLobby() {
  const room = useGameStore((s) => s.room)!;
  const playerId = useGameStore((s) => s.playerId);
  const connected = useGameStore((s) => s.connected);
  const me = room.players.find((p) => p.id === playerId);
  const isVip = room.vipId === playerId;
  const canStart = room.players.filter((p) => p.connected).length >= RULES.minPlayers;
  const others = room.players.filter((p) => p.id !== playerId);

  return (
    <Screen className="mx-auto flex max-w-md flex-col gap-5" beam={false}>
      <header className="flex items-center justify-between">
        <button
          onClick={() => navigate("/")}
          className="rounded-full p-2 text-muted-foreground hover:bg-white/5 hover:text-foreground"
          aria-label="Home"
          data-testid="button-home"
        >
          <Home className="h-5 w-5" />
        </button>
        <Chip>
          ROOM <span className="font-mono tracking-widest text-neon-cyan">{room.code}</span>
          {!connected && <WifiOff className="h-3.5 w-3.5 text-neon-red" />}
        </Chip>
        <button
          onClick={() => {
            leaveSeat();
            navigate("/", { replace: true });
          }}
          className="rounded-full p-2 text-muted-foreground hover:bg-white/5 hover:text-neon-red"
          aria-label="Leave room"
          data-testid="button-leave"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </header>

      {me && (
        <Panel className="relative flex flex-col items-center gap-3 overflow-hidden p-7 text-center animate-rise-in">
          <div className="pointer-events-none absolute -top-16 h-40 w-64 rounded-full blur-3xl" style={{ background: `${me.color}55` }} />
          <div className="relative">
            <div className="absolute inset-0 rounded-full animate-ring-out" style={{ boxShadow: `0 0 0 3px ${me.color}` }} />
            <Avatar player={me} size={92} />
          </div>
          <p className="font-display text-3xl font-bold" data-testid="text-your-name">
            {me.name}
          </p>
          <div className="flex items-center gap-2">
            <Chip className="text-muted-foreground">That's you</Chip>
            {isVip && (
              <Chip className="text-neon-gold">
                <Crown className="h-3.5 w-3.5" /> Party leader
              </Chip>
            )}
            {me.score > 0 && (
              <Chip className="text-neon-gold">
                <Trophy className="h-3.5 w-3.5" /> {me.score}
              </Chip>
            )}
          </div>
        </Panel>
      )}

      {isVip ? (
        <Btn tone="mint" size="lg" block icon={Play} onClick={startRound} disabled={!canStart} data-testid="button-start-mobile">
          {canStart ? "Start game" : "Waiting for players"}
        </Btn>
      ) : (
        <div className="flex items-center justify-center gap-2 py-2 text-muted-foreground">
          <span className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-1.5 w-1.5 rounded-full bg-neon-cyan animate-pulse" style={{ animationDelay: `${i * 200}ms` }} />
            ))}
          </span>
          Waiting for the host to start
        </div>
      )}

      <div className="space-y-2">
        <p className="px-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          In the room · {room.players.length}
        </p>
        {others.length === 0 && <p className="px-1 text-sm text-muted-foreground">Nobody else yet. Share the code!</p>}
        {others.map((p) => (
          <div key={p.id} className="glass flex items-center gap-3 rounded-2xl p-2.5 pr-4 animate-rise-in">
            <Avatar player={p} size={34} />
            <span className="flex-1 truncate font-semibold">{p.name}</span>
            {!p.connected && <WifiOff className="h-4 w-4 text-muted-foreground" />}
            {room.vipId === p.id && <Crown className="h-4 w-4 text-neon-gold" />}
            {p.score > 0 && <span className="font-display text-sm font-bold text-neon-gold">{p.score}</span>}
          </div>
        ))}
      </div>

      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between rounded-2xl px-1 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          How to play
          <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
        </summary>
        <div className="pt-2">
          <HowToPlay compact />
        </div>
      </details>
    </Screen>
  );
}
