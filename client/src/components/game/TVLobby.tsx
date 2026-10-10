import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Play, Users, Trophy } from "lucide-react";
import { useGameStore } from "@/lib/gameStore";
import { startRound } from "@/lib/net";
import { RULES } from "@shared/config";
import { Avatar, HowToPlay, joinBase } from "./common";

export function TVLobby() {
  const room = useGameStore((s) => s.room)!;
  const [qr, setQr] = useState<string>("");
  const [base, setBase] = useState(window.location.origin);

  useEffect(() => {
    joinBase().then(setBase);
  }, []);

  useEffect(() => {
    QRCode.toDataURL(`${base}/?room=${room.code}`, { margin: 1, width: 220 })
      .then(setQr)
      .catch(() => setQr(""));
  }, [base, room.code]);

  const players = room.players;
  const connected = players.filter((p) => p.connected).length;
  const canStart = connected >= RULES.minPlayers;
  const hasScores = players.some((p) => p.score > 0);

  return (
    <div className="h-full overflow-y-auto bg-background p-6 md:p-10">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex flex-col lg:flex-row gap-8 items-center lg:items-stretch">
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-2">
            <p className="text-muted-foreground uppercase tracking-[0.3em]">Room code</p>
            <p className="font-mono text-8xl font-bold tracking-[0.2em] text-primary" data-testid="text-room-code">
              {room.code}
            </p>
            <p className="text-muted-foreground text-lg">
              Scan the code or open <span className="text-foreground font-mono">{base.replace(/^https?:\/\//, "")}</span> on your
              phone
            </p>
          </div>
          {qr && (
            <div className="bg-white p-3 rounded-xl shrink-0 self-center">
              <img src={qr} alt="Join QR code" className="w-52 h-52" />
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-center gap-2 mb-4 text-lg">
            <Users className="w-5 h-5 text-muted-foreground" />
            Players ({players.length}/{RULES.maxPlayers})
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {players.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 p-3 rounded-lg bg-card border border-card-border animate-slide-in"
              >
                <Avatar player={p} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate text-lg" data-testid={`text-player-name-${p.id}`}>
                    {p.name}
                  </p>
                  <p className="text-xs text-muted-foreground">{p.connected ? "ready" : "reconnecting…"}</p>
                </div>
                {hasScores && (
                  <div className="flex items-center gap-1 text-yellow-300 font-display">
                    <Trophy className="w-4 h-4" />
                    {p.score}
                  </div>
                )}
              </div>
            ))}
            {players.length === 0 && (
              <p className="col-span-full text-center text-muted-foreground py-6 animate-pulse">
                Waiting for players to join…
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col items-center gap-2">
          <Button
            size="lg"
            onClick={startRound}
            disabled={!canStart}
            className="px-14 py-7 text-2xl font-display tracking-wider"
            data-testid="button-start-game"
          >
            <Play className="w-7 h-7 mr-2" />
            START
          </Button>
          {!canStart && <p className="text-muted-foreground text-sm">Need at least {RULES.minPlayers} players (3+ is more fun)</p>}
        </div>

        <HowToPlay />
      </div>
    </div>
  );
}
