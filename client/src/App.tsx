import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { useGameStore } from "@/lib/gameStore";
import { initNet } from "@/lib/net";
import { WelcomeScreen } from "@/components/game/WelcomeScreen";
import { TVLobby } from "@/components/game/TVLobby";
import { MobileLobby } from "@/components/game/MobileLobby";
import { TVGameView } from "@/components/game/TVGameView";
import { MobileGameView } from "@/components/game/MobileGameView";

function Splash({ text }: { text: string }) {
  return <div className="h-full flex items-center justify-center text-muted-foreground animate-pulse">{text}</div>;
}

function GameApp() {
  useEffect(() => initNet(), []);
  const kind = useGameStore((s) => s.kind);
  const room = useGameStore((s) => s.room);
  const resuming = useGameStore((s) => s.resuming);

  if (!kind) return resuming ? <Splash text="Reconnecting…" /> : <WelcomeScreen />;
  if (!room) return <Splash text="Connecting…" />;

  if (kind === "tv") return room.phase === "lobby" ? <TVLobby /> : <TVGameView />;
  return room.phase === "lobby" ? <MobileLobby /> : <MobileGameView />;
}

export default function App() {
  return (
    <>
      <Toaster />
      <GameApp />
    </>
  );
}
