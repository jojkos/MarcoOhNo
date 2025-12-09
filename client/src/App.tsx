import { useEffect, useState } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useGameStore } from "@/lib/gameStore";
import { socket, connectSocket, disconnectSocket } from "@/lib/socket";
import { WelcomeScreen } from "@/components/game/WelcomeScreen";
import { TVLobby } from "@/components/game/TVLobby";
import { MobileLobby } from "@/components/game/MobileLobby";
import { RoleReveal } from "@/components/game/RoleReveal";
import { TVGameView } from "@/components/game/TVGameView";
import { MobileGameView } from "@/components/game/MobileGameView";
import { GameOver } from "@/components/game/GameOver";
import { ClientType, GamePhase, type PlayerRole } from "@shared/schema";

type Screen = "welcome" | "lobby" | "role_reveal" | "playing" | "game_over";

function GameApp() {
  const {
    clientType,
    roomCode,
    gameState,
    revealedRole,
    setConnected,
    setGameState,
    setPlayerId,
    setRevealedRole,
    setError,
    reset
  } = useGameStore();

  const [screen, setScreen] = useState<Screen>("welcome");

  useEffect(() => {
    socket.on("connect", () => {
      setConnected(true);
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    socket.on("gameState", (state) => {
      setGameState(state);

      if (!useGameStore.getState().playerId && clientType === ClientType.MOBILE) {
        const playerName = useGameStore.getState().playerName;
        const player = state.players.find(p => p.name === playerName);
        if (player) {
          setPlayerId(player.id);
        }
      }

      const currentPlayerId = useGameStore.getState().playerId;

      // Handle Phase Transitions
      if (state.phase === GamePhase.ROLE_REVEAL) {
        const player = state.players.find(p => p.id === currentPlayerId);
        if (player) {
          setRevealedRole(player.role as PlayerRole);
          // Only show reveal if we're not already playing (avoids loops if animation finishes before phase change)
          if (screen !== "role_reveal" && screen !== "playing") setScreen("role_reveal");
        } else if (clientType === ClientType.TV) {
          if (screen !== "playing") setScreen("playing");
        }
      } else if (state.phase === GamePhase.PLAYING) {
        if (screen !== "playing") {
          // Force switch to playing, even if role_reveal is showing (prevents stuck state)
          setScreen("playing");
        }
      } else if (state.phase === GamePhase.GAME_OVER) {
        if (screen !== "game_over") setScreen("game_over");
      } else if (state.phase === GamePhase.LOBBY) {
        if (screen !== "lobby" && screen !== "welcome") setScreen("lobby");
      }
    });

    socket.on("error", (message) => {
      setError(message);
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("gameState");
      socket.off("error");
    };
  }, [clientType, screen, setConnected, setGameState, setPlayerId, setRevealedRole, setError]);

  const handleRoomCreated = (code: string) => {
    setPlayerId("host");
    setScreen("lobby");
  };

  const handleRoomJoined = () => {
    setScreen("lobby");
  };

  const handleRoleRevealComplete = () => {
    setScreen("playing");
  };

  const handlePlayAgain = () => {
    setScreen("lobby");
  };

  const handleLeave = () => {
    socket.emit("leaveRoom");
    disconnectSocket();
    reset();
    setScreen("welcome");
  };

  if (screen === "welcome") {
    return (
      <WelcomeScreen
        onRoomCreated={handleRoomCreated}
        onRoomJoined={handleRoomJoined}
      />
    );
  }

  if (screen === "lobby") {
    if (clientType === ClientType.TV && roomCode) {
      return <TVLobby roomCode={roomCode} />;
    }
    return <MobileLobby onLeave={handleLeave} />;
  }

  if (screen === "role_reveal" && revealedRole) {
    return (
      <RoleReveal
        role={revealedRole}
        onComplete={handleRoleRevealComplete}
      />
    );
  }

  if (screen === "playing") {
    if (clientType === ClientType.TV) {
      return <TVGameView />;
    }
    return <MobileGameView />;
  }

  if (screen === "game_over" && gameState?.winner) {
    return (
      <GameOver
        winner={gameState.winner}
        onPlayAgain={handlePlayAgain}
        onLeave={handleLeave}
        isTVView={clientType === ClientType.TV}
      />
    );
  }

  return (
    <WelcomeScreen
      onRoomCreated={handleRoomCreated}
      onRoomJoined={handleRoomJoined}
    />
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <GameApp />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
