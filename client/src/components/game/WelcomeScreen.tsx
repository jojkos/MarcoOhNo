import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Flashlight, Users, Tv, Smartphone } from "lucide-react";
import { useGameStore } from "@/lib/gameStore";
import { socket, connectSocket } from "@/lib/socket";
import { ClientType } from "@shared/schema";

interface WelcomeScreenProps {
  onRoomCreated: (roomCode: string) => void;
  onRoomJoined: () => void;
}

export function WelcomeScreen({ onRoomCreated, onRoomJoined }: WelcomeScreenProps) {
  const [mode, setMode] = useState<"select" | "create" | "join">("select");
  const [roomCode, setRoomCode] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { setClientType, setRoomCode: storeSetRoomCode, setPlayerName: storeSetPlayerName, setPlayerId, setError, error } = useGameStore();

  const handleCreateGame = () => {
    setIsLoading(true);
    setError(null);
    connectSocket();
    
    socket.emit("createRoom", ClientType.TV, (code) => {
      setClientType(ClientType.TV);
      storeSetRoomCode(code);
      setIsLoading(false);
      onRoomCreated(code);
    });
  };

  const handleJoinGame = () => {
    if (!roomCode || roomCode.length !== 4) {
      setError("Please enter a 4-digit room code");
      return;
    }
    if (!playerName.trim()) {
      setError("Please enter your name");
      return;
    }

    setIsLoading(true);
    setError(null);
    connectSocket();

    socket.emit("joinRoom", roomCode.toUpperCase(), playerName.trim(), ClientType.MOBILE, (success, errorMsg) => {
      setIsLoading(false);
      if (success) {
        setClientType(ClientType.MOBILE);
        storeSetRoomCode(roomCode.toUpperCase());
        storeSetPlayerName(playerName.trim());
        onRoomJoined();
      } else {
        setError(errorMsg || "Failed to join room");
      }
    });
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-game-seeker/5 rounded-full blur-3xl" />
      </div>
      
      <div className="relative z-10 text-center mb-8 animate-fade-in">
        <div className="flex items-center justify-center gap-3 mb-4">
          <Flashlight className="w-12 h-12 text-game-vision" />
          <h1 className="font-display text-5xl md:text-7xl font-bold tracking-wider text-foreground">
            SHADOW RUN
          </h1>
        </div>
        <p className="text-muted-foreground text-lg font-game">
          Hunt or be hunted in the shadows
        </p>
      </div>

      {mode === "select" && (
        <div className="flex flex-col md:flex-row gap-4 w-full max-w-2xl animate-scale-in">
          <Card 
            className="flex-1 hover-elevate cursor-pointer transition-all"
            onClick={() => setMode("create")}
            data-testid="card-create-game"
          >
            <CardHeader className="text-center pb-2">
              <div className="mx-auto w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mb-2">
                <Tv className="w-8 h-8 text-primary" />
              </div>
              <CardTitle className="font-display text-xl tracking-wide">CREATE GAME</CardTitle>
            </CardHeader>
            <CardContent className="text-center">
              <p className="text-muted-foreground text-sm">
                Host a game on TV for others to join
              </p>
            </CardContent>
          </Card>

          <Card 
            className="flex-1 hover-elevate cursor-pointer transition-all"
            onClick={() => setMode("join")}
            data-testid="card-join-game"
          >
            <CardHeader className="text-center pb-2">
              <div className="mx-auto w-16 h-16 rounded-full bg-game-runner/20 flex items-center justify-center mb-2">
                <Smartphone className="w-8 h-8 text-game-runner" />
              </div>
              <CardTitle className="font-display text-xl tracking-wide">JOIN GAME</CardTitle>
            </CardHeader>
            <CardContent className="text-center">
              <p className="text-muted-foreground text-sm">
                Join from your mobile device
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {mode === "create" && (
        <Card className="w-full max-w-md animate-slide-in">
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mb-2">
              <Tv className="w-8 h-8 text-primary" />
            </div>
            <CardTitle className="font-display text-2xl tracking-wide">CREATE LOBBY</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-center text-muted-foreground">
              This screen will become the main game display. Others will join using their phones.
            </p>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                onClick={() => setMode("select")}
                className="flex-1"
                data-testid="button-back"
              >
                Back
              </Button>
              <Button 
                onClick={handleCreateGame}
                disabled={isLoading}
                className="flex-1"
                data-testid="button-create-lobby"
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                    Creating...
                  </span>
                ) : (
                  <>
                    <Users className="w-4 h-4 mr-2" />
                    Create Lobby
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {mode === "join" && (
        <Card className="w-full max-w-md animate-slide-in">
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-game-runner/20 flex items-center justify-center mb-2">
              <Smartphone className="w-8 h-8 text-game-runner" />
            </div>
            <CardTitle className="font-display text-2xl tracking-wide">JOIN GAME</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-2 block">
                Room Code
              </label>
              <Input
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase().slice(0, 4))}
                placeholder="XXXX"
                className="text-center text-3xl font-mono tracking-[0.5em] h-16"
                maxLength={4}
                data-testid="input-room-code"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-2 block">
                Your Name
              </label>
              <Input
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value.slice(0, 12))}
                placeholder="Enter your name"
                className="text-center text-lg"
                maxLength={12}
                data-testid="input-player-name"
              />
            </div>
            {error && (
              <p className="text-destructive text-sm text-center" data-testid="text-error">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                onClick={() => {
                  setMode("select");
                  setError(null);
                }}
                className="flex-1"
                data-testid="button-back"
              >
                Back
              </Button>
              <Button 
                onClick={handleJoinGame}
                disabled={isLoading || roomCode.length !== 4 || !playerName.trim()}
                className="flex-1"
                data-testid="button-join"
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                    Joining...
                  </span>
                ) : (
                  "Join Game"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
