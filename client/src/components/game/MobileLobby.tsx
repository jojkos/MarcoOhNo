import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, CheckCircle, Circle, Tv, LogOut } from "lucide-react";
import { useGameStore } from "@/lib/gameStore";
import { socket } from "@/lib/socket";

interface MobileLobbyProps {
  onLeave: () => void;
}

export function MobileLobby({ onLeave }: MobileLobbyProps) {
  const { gameState, playerId, playerName, roomCode } = useGameStore();

  const players = gameState?.players || [];
  const currentPlayer = players.find(p => p.id === playerId);
  const isReady = currentPlayer?.status === "ready";


  const handleLeave = () => {
    socket.emit("leaveRoom");
    onLeave();
  };

  return (
    <div className="min-h-screen flex flex-col p-4 bg-background">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-0 w-48 h-48 bg-game-runner/5 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 flex-1 flex flex-col">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-wider">LOBBY</h1>
            <p className="text-muted-foreground text-sm flex items-center gap-1">
              <Tv className="w-3 h-3" />
              Room: <span className="font-mono text-primary">{roomCode}</span>
            </p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleLeave}
            data-testid="button-leave"
          >
            <LogOut className="w-5 h-5" />
          </Button>
        </div>

        <Card className="mb-4">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-xl"
                style={{ backgroundColor: currentPlayer?.color || "#888" }}
              >
                {playerName.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1">
                <p className="font-medium text-lg" data-testid="text-your-name">{playerName}</p>
                <p className="text-sm text-muted-foreground">You</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex-1 space-y-3">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Users className="w-4 h-4" />
            <span className="text-sm font-medium">Other Players ({players.length - 1})</span>
          </div>

          <div className="space-y-2">
            {players.filter(p => p.id !== playerId).map((player, index) => (
              <Card
                key={player.id}
                className="animate-slide-in"
                style={{ animationDelay: `${index * 0.05}s` }}
              >
                <CardContent className="flex items-center gap-3 p-3">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm"
                    style={{ backgroundColor: player.color }}
                  >
                    {player.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate text-sm">{player.name}</p>
                  </div>

                </CardContent>
              </Card>
            ))}
          </div>

          {players.length < 2 && (
            <div className="text-center py-4">
              <p className="text-muted-foreground text-sm">
                Waiting for more players...
              </p>
            </div>
          )}
        </div>

        <div className="pt-4 space-y-3">
          <div className="text-center py-4 text-muted-foreground animate-pulse">
            Waiting for host to start game...
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Watch the TV screen for game start
          </p>
        </div>
      </div>
    </div>
  );
}
