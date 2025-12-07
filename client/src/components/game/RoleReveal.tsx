import { useEffect, useState } from "react";
import { Flashlight, PersonStanding, Eye, Target } from "lucide-react";
import { PlayerRole } from "@shared/schema";

interface RoleRevealProps {
  role: PlayerRole;
  onComplete: () => void;
}

export function RoleReveal({ role, onComplete }: RoleRevealProps) {
  const [animationPhase, setAnimationPhase] = useState<"enter" | "hold" | "exit">("enter");

  useEffect(() => {
    const timer1 = setTimeout(() => setAnimationPhase("hold"), 300);
    const timer2 = setTimeout(() => setAnimationPhase("exit"), 2500);
    const timer3 = setTimeout(onComplete, 3000);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, [onComplete]);

  const isSeeker = role === "seeker";

  return (
    <div 
      className={`fixed inset-0 z-50 flex items-center justify-center transition-all duration-500
        ${animationPhase === "enter" ? "bg-black/0" : "bg-black/90"}
        ${animationPhase === "exit" ? "opacity-0" : "opacity-100"}`}
    >
      <div 
        className={`text-center transition-all duration-500
          ${animationPhase === "enter" ? "scale-50 opacity-0" : "scale-100 opacity-100"}
          ${animationPhase === "exit" ? "scale-150 opacity-0" : ""}`}
      >
        <div 
          className={`mx-auto w-32 h-32 md:w-40 md:h-40 rounded-full flex items-center justify-center mb-6
            ${isSeeker ? "bg-game-seeker/30" : "bg-game-runner/30"}
            ${animationPhase === "hold" ? "animate-pulse-slow" : ""}`}
        >
          {isSeeker ? (
            <Flashlight className="w-16 h-16 md:w-20 md:h-20 text-game-seeker" />
          ) : (
            <PersonStanding className="w-16 h-16 md:w-20 md:h-20 text-game-runner" />
          )}
        </div>

        <h1 
          className={`font-display text-4xl md:text-7xl font-bold tracking-wider mb-4
            ${isSeeker ? "text-game-seeker" : "text-game-runner"}`}
          data-testid="text-role"
        >
          {isSeeker ? "YOU ARE THE SEEKER" : "RUN!"}
        </h1>

        <p className="text-xl md:text-2xl text-muted-foreground font-game">
          {isSeeker ? (
            <span className="flex items-center justify-center gap-2">
              <Eye className="w-5 h-5" />
              Hunt them down before time runs out
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              <Target className="w-5 h-5" />
              Avoid the seeker's flashlight!
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
