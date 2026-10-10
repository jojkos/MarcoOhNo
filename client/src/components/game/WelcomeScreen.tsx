import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tv, Smartphone } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { hostGame, joinGame, rememberedName } from "@/lib/net";
import { unlockAudio } from "@/lib/sfx";

export function WelcomeScreen() {
  const urlRoom = new URLSearchParams(window.location.search).get("room")?.toUpperCase().slice(0, 4) ?? "";
  const [mode, setMode] = useState<"select" | "join">(urlRoom ? "join" : "select");
  const [roomCode, setRoomCode] = useState(urlRoom);
  const [playerName, setPlayerName] = useState(rememberedName());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const host = async () => {
    unlockAudio();
    setBusy(true);
    setError(await hostGame());
    setBusy(false);
  };

  const join = async () => {
    unlockAudio();
    setBusy(true);
    setError(null);
    const err = await joinGame(roomCode.toUpperCase(), playerName.trim());
    setBusy(false);
    if (err) setError(err);
    else window.history.replaceState(null, "", window.location.pathname);
  };

  return (
    <div className="h-full overflow-y-auto flex flex-col items-center justify-center p-4 bg-background">
      <div className="relative z-10 text-center mb-6">
        <Logo />
        <p className="text-muted-foreground text-lg font-game mt-2">Hide in the dark. Grab the orbs. Don't get lit.</p>
      </div>

      {mode === "select" && (
        <div className="flex flex-col md:flex-row gap-4 w-full max-w-2xl">
          <Card className="flex-1 hover-elevate cursor-pointer" onClick={host} data-testid="card-create-game">
            <CardHeader className="text-center pb-2">
              <div className="mx-auto w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mb-2">
                <Tv className="w-8 h-8 text-primary" />
              </div>
              <CardTitle className="font-display text-xl tracking-wide">HOST ON THIS SCREEN</CardTitle>
            </CardHeader>
            <CardContent className="text-center text-muted-foreground text-sm">
              Open this on the TV or laptop everyone can see.
            </CardContent>
          </Card>
          <Card className="flex-1 hover-elevate cursor-pointer" onClick={() => setMode("join")} data-testid="card-join-game">
            <CardHeader className="text-center pb-2">
              <div className="mx-auto w-16 h-16 rounded-full bg-game-runner/20 flex items-center justify-center mb-2">
                <Smartphone className="w-8 h-8 text-game-runner" />
              </div>
              <CardTitle className="font-display text-xl tracking-wide">JOIN WITH PHONE</CardTitle>
            </CardHeader>
            <CardContent className="text-center text-muted-foreground text-sm">Your phone is your controller.</CardContent>
          </Card>
        </div>
      )}

      {mode === "join" && (
        <Card className="w-full max-w-md">
          <CardContent className="space-y-4 pt-6">
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-2 block">Room code</label>
              <Input
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4))}
                placeholder="ABCD"
                className="text-center text-3xl font-mono tracking-[0.5em] h-16"
                autoCapitalize="characters"
                autoComplete="off"
                data-testid="input-room-code"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-2 block">Your name</label>
              <Input
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value.slice(0, 12))}
                onKeyDown={(e) => e.key === "Enter" && roomCode.length === 4 && playerName.trim() && join()}
                placeholder="Name"
                className="text-center text-lg h-12"
                data-testid="input-player-name"
              />
            </div>
            {error && (
              <p className="text-destructive text-sm text-center" data-testid="text-error">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setMode("select")} className="flex-1" data-testid="button-back">
                Back
              </Button>
              <Button
                onClick={join}
                disabled={busy || roomCode.length !== 4 || !playerName.trim()}
                className="flex-1"
                data-testid="button-join"
              >
                {busy ? "Joining…" : "Join"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {mode === "select" && error && <p className="text-destructive mt-4">{error}</p>}
    </div>
  );
}
