import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Trophy, Skull, Clock, Users, RotateCcw, Home } from "lucide-react";
import { useGameStore } from "@/lib/gameStore";
import { socket } from "@/lib/socket";

interface GameOverProps {
  winner: "seeker" | "runners";
  onPlayAgain: () => void;
  onLeave: () => void;
  isTVView: boolean;
}

export function GameOver({ winner, onPlayAgain, onLeave, isTVView }: GameOverProps) {
  const { gameState, getPlayer } = useGameStore();

  const handlePlayAgain = () => {
    socket.emit("playAgain");
    onPlayAgain();
  };

  const player = getPlayer();
  const seekerWon = winner === "seeker";
  const seeker = gameState?.players.find(p => p.role === "seeker");
  const runners = gameState?.players.filter(p => p.role === "runner") || [];
  const caughtRunners = runners.filter(p => p.status === "caught");
  const survivedRunners = runners.filter(p => p.status === "alive");

  const playerWon = player && (
    (player.role === "seeker" && seekerWon) ||
    (player.role === "runner" && !seekerWon && player.status === "alive")
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-2xl p-4 md:p-8 space-y-6">
        <div className="text-center animate-scale-in">
          <div
            className={`mx-auto w-24 h-24 md:w-32 md:h-32 rounded-full flex items-center justify-center mb-4
              ${seekerWon ? "bg-game-seeker/30" : "bg-game-runner/30"}`}
          >
            {seekerWon ? (
              <Skull className="w-12 h-12 md:w-16 md:h-16 text-game-seeker" />
            ) : (
              <Trophy className="w-12 h-12 md:w-16 md:h-16 text-game-runner" />
            )}
          </div>

          <h1
            className={`font-display text-4xl md:text-6xl font-bold tracking-wider mb-2
              ${seekerWon ? "text-game-seeker" : "text-game-runner"}`}
            data-testid="text-winner"
          >
            {seekerWon ? "SEEKER WINS!" : "RUNNERS SURVIVE!"}
          </h1>

          {!isTVView && player && (
            <p className="text-xl md:text-2xl text-muted-foreground">
              {playerWon ? "You won!" : "Better luck next time!"}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-4 md:p-6">
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-xl"
                  style={{ backgroundColor: seeker?.color || "#e74c3c" }}
                >
                  {seeker?.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-medium text-lg">{seeker?.name}</p>
                  <p className="text-sm text-game-seeker">Seeker</p>
                </div>
              </div>
              <div className="flex items-center gap-4 text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Skull className="w-4 h-4" />
                  <span>{caughtRunners.length} caught</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 md:p-6">
              <div className="flex items-center gap-2 mb-4">
                <Users className="w-5 h-5 text-game-runner" />
                <span className="font-medium">Runners</span>
              </div>
              <div className="space-y-2">
                {runners.map(runner => (
                  <div
                    key={runner.id}
                    className={`flex items-center gap-2 ${runner.status === "caught" ? "opacity-50" : ""}`}
                  >
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                      style={{ backgroundColor: runner.color }}
                    >
                      {runner.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-sm flex-1">{runner.name}</span>
                    {runner.status === "caught" ? (
                      <Skull className="w-4 h-4 text-game-caught" />
                    ) : (
                      <Trophy className="w-4 h-4 text-game-runner" />
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col md:flex-row gap-3 justify-center pt-4">
          {isTVView && (
            <Button
              size="lg"
              onClick={handlePlayAgain}
              className="px-8 py-6 text-lg font-display tracking-wider"
              data-testid="button-play-again"
            >
              <RotateCcw className="w-5 h-5 mr-2" />
              PLAY AGAIN
            </Button>
          )}
          <Button
            size="lg"
            variant="outline"
            onClick={onLeave}
            className="px-8 py-6 text-lg font-display tracking-wider"
            data-testid="button-leave"
          >
            <Home className="w-5 h-5 mr-2" />
            LEAVE
          </Button>
        </div>
      </div>
    </div>
  );
}
