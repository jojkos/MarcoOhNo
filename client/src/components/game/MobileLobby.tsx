import { navigate } from "wouter/use-browser-location";
import { Play, Trophy, Crown, LogOut, Home, ChevronDown, WifiOff, Bot, Plus, RefreshCw } from "lucide-react";
import { useGameStore } from "@/lib/gameStore";
import { leaveSeat, send } from "@/lib/session";
import { saveFace } from "@/lib/storage";
import { FACES, RULES } from "@shared/config";
import { Btn, Chip, Panel, Screen } from "@/components/kit";
import { Blob } from "./Blob";
import { SoundToggle } from "./SoundToggle";
import { HowToPlay } from "./common";

export function MobileLobby() {
  const view = useGameStore((s) => s.view)!;
  const playerId = useGameStore((s) => s.playerId);
  const status = useGameStore((s) => s.attachment?.status);
  const me = view.players.find((p) => p.id === playerId);
  const isVip = view.vipId === playerId;
  const canStart = view.players.filter((p) => p.connected).length >= RULES.minPlayers;
  const others = view.players.filter((p) => p.id !== playerId);

  const nextFace = () => {
    if (!me) return;
    const face = (me.face + 1) % FACES.length;
    saveFace(face);
    send.setFace(face);
  };

  return (
    <Screen className="mx-auto flex max-w-md flex-col gap-5" beam={false}>
      <header className="flex items-center justify-between">
        <button onClick={() => navigate("/")} className="rounded-full p-2 text-muted-foreground hover:bg-white/5 hover:text-foreground" aria-label="Home" data-testid="button-home">
          <Home className="h-5 w-5" />
        </button>
        <Chip>
          ROOM <span className="font-mono tracking-widest text-neon-cyan">{view.code}</span>
          {status === "reconnecting" && <WifiOff className="h-3.5 w-3.5 text-neon-red" />}
        </Chip>
        <div className="flex items-center">
          <SoundToggle />
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
        </div>
      </header>

      {me && (
        <Panel className="relative flex flex-col items-center gap-3 overflow-hidden p-7 text-center animate-rise-in">
          <div className="pointer-events-none absolute -top-16 h-40 w-64 rounded-full blur-3xl" style={{ background: `${me.color}55` }} />
          <button onClick={nextFace} className="group relative transition active:scale-95" aria-label="Change face" data-testid="button-change-face">
            <Blob color={me.color} face={me.face} size={104} />
            <span className="absolute -bottom-1 -right-1 rounded-full border border-white/20 bg-black/70 p-1.5 text-muted-foreground group-hover:text-foreground">
              <RefreshCw className="h-3.5 w-3.5" />
            </span>
          </button>
          <p className="font-display text-3xl font-bold" data-testid="text-your-name">
            {me.name}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Chip className="text-muted-foreground">Tap your face to change it</Chip>
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
        <div className="flex gap-2">
          <Btn tone="mint" size="lg" block icon={Play} onClick={() => send.start()} disabled={!canStart} data-testid="button-start-mobile">
            {canStart ? "Start game" : "Waiting for players"}
          </Btn>
          {!view.hostConnected && (
            <Btn tone="ghost" size="lg" icon={Plus} onClick={() => send.addBot()} aria-label="Add bot" data-testid="button-add-bot-mobile">
              <Bot className="h-5 w-5" />
            </Btn>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-center gap-2 py-2 text-muted-foreground">
          <span className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-neon-cyan" style={{ animationDelay: `${i * 200}ms` }} />
            ))}
          </span>
          Waiting for the host to start
        </div>
      )}

      <div className="space-y-2">
        <p className="px-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">In the room · {view.players.length}</p>
        {others.length === 0 && <p className="px-1 text-sm text-muted-foreground">Nobody else yet. Share the code!</p>}
        {others.map((p) => (
          <div key={p.id} className="glass flex items-center gap-3 rounded-2xl p-2 pr-4 animate-rise-in">
            <Blob color={p.color} face={p.face} size={38} dim={!p.connected} glow={false} />
            <span className="flex flex-1 items-center gap-1.5 truncate font-semibold">
              {p.isBot && <Bot className="h-4 w-4 text-muted-foreground" />}
              {p.name}
            </span>
            {!p.connected && <WifiOff className="h-4 w-4 text-muted-foreground" />}
            {view.vipId === p.id && <Crown className="h-4 w-4 text-neon-gold" />}
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
