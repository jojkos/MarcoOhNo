import { Button } from "@/components/ui/button";
import { LogOut, Play, Trophy, Crown } from "lucide-react";
import { useGameStore } from "@/lib/gameStore";
import { leaveGame, startRound } from "@/lib/net";
import { RULES } from "@shared/config";
import { Avatar, HowToPlay } from "./common";

export function MobileLobby() {
  const room = useGameStore((s) => s.room)!;
  const playerId = useGameStore((s) => s.playerId);
  const me = room.players.find((p) => p.id === playerId);
  const isVip = room.vipId === playerId;
  const canStart = room.players.filter((p) => p.connected).length >= RULES.minPlayers;

  return (
    <div className="h-full overflow-y-auto bg-background p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-wider">LOBBY</h1>
          <p className="text-muted-foreground text-sm">
            Room <span className="font-mono text-primary">{room.code}</span>
          </p>
        </div>
        <Button size="icon" variant="ghost" onClick={leaveGame} data-testid="button-leave">
          <LogOut className="w-5 h-5" />
        </Button>
      </div>

      {me && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-card border border-card-border">
          <Avatar player={me} size={52} />
          <div className="flex-1">
            <p className="font-semibold text-xl" data-testid="text-your-name">
              {me.name}
            </p>
            <p className="text-sm text-muted-foreground">That's you{isVip ? ", and you can start the game" : ""}</p>
          </div>
          <div className="flex items-center gap-1 text-yellow-300 font-display">
            <Trophy className="w-4 h-4" />
            {me.score}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {room.players
          .filter((p) => p.id !== playerId)
          .map((p) => (
            <div key={p.id} className="flex items-center gap-3 p-2 rounded-md bg-white/5">
              <Avatar player={p} size={30} />
              <span className="flex-1 truncate">{p.name}</span>
              {room.vipId === p.id && <Crown className="w-4 h-4 text-yellow-300" />}
              <span className="text-sm text-muted-foreground font-display">{p.score}</span>
            </div>
          ))}
      </div>

      {isVip ? (
        <Button
          size="lg"
          onClick={startRound}
          disabled={!canStart}
          className="py-6 text-lg font-display tracking-wider"
          data-testid="button-start-mobile"
        >
          <Play className="w-5 h-5 mr-2" />
          {canStart ? "START GAME" : "WAITING FOR PLAYERS"}
        </Button>
      ) : (
        <p className="text-center text-muted-foreground animate-pulse py-2">Waiting for the host to start…</p>
      )}

      <HowToPlay compact />
    </div>
  );
}
