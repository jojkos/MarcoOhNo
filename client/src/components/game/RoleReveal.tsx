import { Flashlight, PersonStanding } from "lucide-react";
import type { Role } from "@shared/protocol";

export function RoleReveal({ role, seekerName, orbs }: { role: Role; seekerName: string; orbs: number }) {
  const isSeeker = role === "seeker";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-6 animate-fade-in">
      <div className="text-center animate-scale-in max-w-md">
        <div
          className={`mx-auto w-32 h-32 rounded-full flex items-center justify-center mb-6 animate-pulse-slow ${
            isSeeker ? "bg-game-seeker/30" : "bg-game-runner/30"
          }`}
        >
          {isSeeker ? (
            <Flashlight className="w-16 h-16 text-game-seeker" />
          ) : (
            <PersonStanding className="w-16 h-16 text-game-runner" />
          )}
        </div>
        <h1
          className={`font-display text-4xl font-bold tracking-wider mb-4 ${isSeeker ? "text-game-seeker" : "text-game-runner"}`}
          data-testid="text-role"
        >
          {isSeeker ? "YOU ARE THE SEEKER" : "YOU ARE A RUNNER"}
        </h1>
        <p className="text-lg text-muted-foreground font-game leading-snug">
          {isSeeker
            ? `Count to 10 while they hide. Then catch them all, or stop them collecting ${orbs} orbs before time runs out.`
            : `${seekerName} is hunting. You have 10 seconds to scatter. Then collect ${orbs} orbs as a team and free caged friends.`}
        </p>
      </div>
    </div>
  );
}
