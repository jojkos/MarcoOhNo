import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Clock, Users, Skull, Megaphone } from "lucide-react";
import { useGameStore } from "@/lib/gameStore";
import { socket } from "@/lib/socket";
import { MAP_CONFIG } from "@shared/schema";

interface GameHUDProps {
  isTVView: boolean;
}

export function GameHUD({ isTVView }: GameHUDProps) {
  const { gameState, isSeeker, getPlayer } = useGameStore();
  
  if (!gameState) return null;
  
  const player = getPlayer();
  const timeRemaining = gameState.timeRemaining;
  const isLowTime = timeRemaining <= 10000;
  const formatTime = (ms: number) => {
    const seconds = Math.ceil(ms / 1000);
    return seconds.toString().padStart(2, "0");
  };

  const alivePlayers = gameState.players.filter(p => p.status === "alive" && p.role === "runner");
  const caughtPlayers = gameState.players.filter(p => p.status === "caught");
  const marcoOnCooldown = gameState.marcoCooldown > 0;
  const marcoCooldownProgress = Math.max(0, 100 - (gameState.marcoCooldown / MAP_CONFIG.marcoCooldown) * 100);

  const handleMarco = () => {
    if (!marcoOnCooldown && isSeeker()) {
      socket.emit("triggerMarco");
    }
  };

  if (isTVView) {
    return (
      <div className="absolute inset-x-0 top-0 p-4 pointer-events-none z-20">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-2 pointer-events-auto">
            {gameState.players.map(p => (
              <div 
                key={p.id}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md bg-background/80 backdrop-blur-sm
                  ${p.status === "caught" ? "opacity-50" : ""}`}
              >
                <div 
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: p.color }}
                />
                <span className="text-sm font-medium">{p.name}</span>
                {p.role === "seeker" && (
                  <Badge variant="destructive" className="text-xs">SEEKER</Badge>
                )}
                {p.status === "caught" && (
                  <Skull className="w-3 h-3 text-game-caught" />
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-col items-center gap-2">
            <div 
              className={`px-6 py-3 rounded-md bg-background/80 backdrop-blur-sm
                ${isLowTime ? "animate-pulse-fast border-2 border-destructive" : ""}`}
            >
              <div className="flex items-center gap-2">
                <Clock className={`w-6 h-6 ${isLowTime ? "text-destructive" : "text-muted-foreground"}`} />
                <span 
                  className={`font-display text-5xl font-bold tabular-nums
                    ${isLowTime ? "text-destructive" : "text-foreground"}`}
                  data-testid="text-timer"
                >
                  {formatTime(timeRemaining)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2 pointer-events-auto">
            <div className="flex items-center gap-3 px-4 py-2 rounded-md bg-background/80 backdrop-blur-sm">
              <Users className="w-5 h-5 text-game-runner" />
              <span className="font-medium">{alivePlayers.length} Alive</span>
            </div>
            {caughtPlayers.length > 0 && (
              <div className="flex items-center gap-3 px-4 py-2 rounded-md bg-background/80 backdrop-blur-sm">
                <Skull className="w-5 h-5 text-game-caught" />
                <span className="font-medium">{caughtPlayers.length} Caught</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-x-0 top-0 p-2 pointer-events-none z-20">
      <div className="flex items-center justify-between gap-2">
        <Badge 
          variant={player?.role === "seeker" ? "destructive" : "default"}
          className="pointer-events-auto"
        >
          {player?.role === "seeker" ? "SEEKER" : "RUNNER"}
        </Badge>

        <div 
          className={`px-3 py-1 rounded-md bg-background/80 backdrop-blur-sm
            ${isLowTime ? "animate-pulse-fast" : ""}`}
        >
          <span 
            className={`font-display text-2xl font-bold tabular-nums
              ${isLowTime ? "text-destructive" : "text-foreground"}`}
          >
            {formatTime(timeRemaining)}
          </span>
        </div>

        <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-background/80 backdrop-blur-sm pointer-events-auto">
          <Users className="w-4 h-4 text-game-runner" />
          <span className="text-sm font-medium">{alivePlayers.length}</span>
        </div>
      </div>
    </div>
  );
}
