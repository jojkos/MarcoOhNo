import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Copy, Users, Play, CheckCircle, Circle, Smartphone } from "lucide-react";
import { useGameStore } from "@/lib/gameStore";
import { socket } from "@/lib/socket";
import { useToast } from "@/hooks/use-toast";

interface TVLobbyProps {
  roomCode: string;
}

export function TVLobby({ roomCode }: TVLobbyProps) {
  const { gameState, isHost } = useGameStore();
  const { toast } = useToast();

  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomCode);
    toast({
      title: "Copied!",
      description: "Room code copied to clipboard",
    });
  };

  const handleStartGame = () => {
    socket.emit("startGame");
  };

  const players = gameState?.players || [];
  const canStart = players.length >= 2;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 bg-background">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/4 w-[500px] h-[500px] bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 right-1/4 w-[400px] h-[400px] bg-game-runner/5 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-4xl space-y-8 animate-fade-in">
        <div className="text-center">
          <h1 className="font-display text-4xl md:text-6xl font-bold tracking-wider text-foreground mb-2">
            LOBBY
          </h1>
          <p className="text-muted-foreground text-lg">
            Waiting for players to join...
          </p>
        </div>

        <Card className="mx-auto max-w-md">
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-2 uppercase tracking-wide">
                Room Code
              </p>
              <div className="flex items-center justify-center gap-3">
                <span
                  className="font-mono text-6xl font-bold tracking-[0.3em] text-primary"
                  data-testid="text-room-code"
                >
                  {roomCode}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={copyRoomCode}
                  data-testid="button-copy-code"
                >
                  <Copy className="w-5 h-5" />
                </Button>
              </div>
              <div className="flex items-center justify-center gap-2 mt-4 text-muted-foreground">
                <Smartphone className="w-4 h-4" />
                <span className="text-sm">Join on your phone at this URL</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <div className="flex items-center justify-center gap-2">
            <Users className="w-5 h-5 text-muted-foreground" />
            <span className="text-lg font-medium">
              Players ({players.length}/6)
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-w-2xl mx-auto">
            {players.map((player, index) => (
              <Card
                key={player.id}
                className="animate-slide-in"
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                <CardContent className="flex items-center gap-3 p-4">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-lg"
                    style={{ backgroundColor: player.color }}
                  >
                    {player.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate" data-testid={`text-player-name-${player.id}`}>
                      {player.name}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}

            {players.length < 6 && Array.from({ length: Math.min(3, 6 - players.length) }).map((_, i) => (
              <Card key={`empty-${i}`} className="border-dashed opacity-50">
                <CardContent className="flex items-center justify-center gap-2 p-4 h-[72px]">
                  <Users className="w-5 h-5 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Waiting...</span>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {players.length < 2 && (
          <div className="text-center">
            <Badge variant="secondary" className="text-sm">
              Need at least 2 players to start
            </Badge>
          </div>
        )}

        <div className="flex justify-center">
          <Button
            size="lg"
            onClick={handleStartGame}
            disabled={!canStart}
            className="px-12 py-6 text-xl font-display tracking-wider"
            data-testid="button-start-game"
          >
            <Play className="w-6 h-6 mr-2" />
            START GAME
          </Button>
        </div>
      </div>
    </div>
  );
}
