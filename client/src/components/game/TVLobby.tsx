import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { navigate } from "wouter/use-browser-location";
import { Play, Trophy, Home, Eye, WifiOff, Bot, Plus, Minus } from "lucide-react";
import { useGameStore } from "@/lib/gameStore";
import { send } from "@/lib/session";
import { RULES } from "@shared/config";
import { Btn, Chip, Logo, Panel, Screen } from "@/components/kit";
import { Blob } from "./Blob";
import { SoundToggle } from "./SoundToggle";
import { HowToPlay, joinBase } from "./common";

export function TVLobby() {
  const view = useGameStore((s) => s.view)!;
  const isHost = useGameStore((s) => s.attachment?.isHost ?? false);
  const [qr, setQr] = useState("");
  const [base, setBase] = useState(window.location.origin);

  useEffect(() => {
    joinBase().then(setBase);
  }, []);

  const joinUrl = `${base}/join/${view.code}`;
  useEffect(() => {
    QRCode.toDataURL(joinUrl, { margin: 1, width: 360, color: { dark: "#05060d", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(""));
  }, [joinUrl]);

  const players = view.players;
  const connected = players.filter((p) => p.connected).length;
  const canStart = connected >= RULES.minPlayers;
  const hasScores = players.some((p) => p.score > 0);
  const hasBots = players.some((p) => p.isBot);
  const empty = Math.max(0, Math.min(RULES.maxPlayers, Math.max(4, players.length + 1)) - players.length);

  return (
    <Screen className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-6 lg:px-10">
      <header className="flex items-center justify-between">
        <Logo size="sm" />
        <div className="flex items-center gap-2">
          {!isHost && (
            <Chip className="text-muted-foreground">
              <Eye className="h-3.5 w-3.5" /> Watching
            </Chip>
          )}
          <SoundToggle />
          <Btn tone="ghost" size="sm" icon={Home} onClick={() => navigate("/")}>
            Home
          </Btn>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(320px,420px)_1fr]">
        <Panel className="flex flex-col items-center gap-5 p-7 text-center animate-rise-in">
          <p className="font-display text-sm font-bold uppercase tracking-[0.3em] text-muted-foreground">Scan to join</p>
          <div className="relative rounded-3xl bg-white p-3 shadow-[0_0_60px_-10px_hsl(var(--primary)/0.7)]">
            {qr ? <img src={qr} alt="Join QR code" className="h-56 w-56 rounded-xl" /> : <div className="h-56 w-56" />}
          </div>
          <div>
            <p className="text-sm text-muted-foreground">or open</p>
            <p className="font-mono text-lg text-foreground">{base.replace(/^https?:\/\//, "")}</p>
            <p className="mt-1 text-sm text-muted-foreground">and enter the code</p>
          </div>
          <div className="flex gap-2" data-testid="text-room-code">
            {view.code.split("").map((c, i) => (
              <span
                key={i}
                className="flex h-20 w-16 items-center justify-center rounded-2xl border border-neon-cyan/40 bg-black/40 font-mono text-5xl font-extrabold text-neon-cyan glow-text-cyan"
              >
                {c}
              </span>
            ))}
          </div>
        </Panel>

        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="font-display text-3xl font-bold uppercase tracking-wide">
              Players <span className="text-muted-foreground">{players.length}/{RULES.maxPlayers}</span>
            </h2>
            <div className="flex items-center gap-2">
              {hasScores && (
                <Chip className="text-neon-gold">
                  <Trophy className="h-3.5 w-3.5" /> Scores carry over
                </Chip>
              )}
              {isHost && (
                <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1">
                  <span className="flex items-center gap-1.5 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <Bot className="h-4 w-4" /> Bots
                  </span>
                  <button
                    className="rounded-full p-1.5 hover:bg-white/10 disabled:opacity-30"
                    onClick={() => send.removeBot()}
                    disabled={!hasBots}
                    aria-label="Remove a bot"
                    data-testid="button-remove-bot"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <button
                    className="rounded-full p-1.5 hover:bg-white/10 disabled:opacity-30"
                    onClick={() => send.addBot()}
                    disabled={players.length >= RULES.maxPlayers}
                    aria-label="Add a bot"
                    data-testid="button-add-bot"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {players.map((p, i) => (
              <div key={p.id} className="glass relative flex flex-col items-center gap-2 overflow-hidden rounded-3xl p-5 animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
                <div className="pointer-events-none absolute inset-x-0 -top-10 h-24 blur-2xl" style={{ background: `${p.color}33` }} />
                <Blob color={p.color} face={p.face} size={72} dim={!p.connected} />
                <p className="flex max-w-full items-center gap-1.5 truncate font-display text-xl font-bold" data-testid={`text-player-name-${p.id}`}>
                  {p.isBot && <Bot className="h-4 w-4 text-muted-foreground" />}
                  {p.name}
                </p>
                <div className="flex h-6 items-center gap-2 text-sm text-muted-foreground">
                  {!p.connected ? (
                    <>
                      <WifiOff className="h-4 w-4" /> reconnecting…
                    </>
                  ) : hasScores ? (
                    <span className="flex items-center gap-1 font-display font-bold text-neon-gold">
                      <Trophy className="h-4 w-4" /> {p.score}
                    </span>
                  ) : (
                    <span className="text-neon-mint">{p.isBot ? "beep boop" : "ready"}</span>
                  )}
                </div>
              </div>
            ))}
            {Array.from({ length: empty }, (_, i) => (
              <div key={`empty-${i}`} className="flex min-h-[170px] flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-white/10 text-muted-foreground">
                <div className="h-16 w-16 animate-pulse-slow rounded-full border-2 border-dashed border-white/15" />
                <span className="text-sm">waiting…</span>
              </div>
            ))}
          </div>

          <div className="mt-auto flex flex-col items-center gap-2 pt-2">
            {isHost ? (
              <>
                <Btn tone="cyan" size="xl" icon={Play} onClick={() => send.start()} disabled={!canStart} data-testid="button-start-game">
                  Start game
                </Btn>
                <p className="text-sm text-muted-foreground">
                  {canStart ? "Everyone in? Let's go." : `Need at least ${RULES.minPlayers} players. Add bots to fill the room.`}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">The host's screen starts the game.</p>
            )}
          </div>
        </div>
      </div>

      <HowToPlay />
    </Screen>
  );
}
