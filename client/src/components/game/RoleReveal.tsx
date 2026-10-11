import { Flashlight, Footprints } from "lucide-react";
import type { Role } from "@shared/schema";
import { cn } from "@/lib/utils";

export function RoleReveal({ role, seekerName, orbs }: { role: Role; seekerName: string; orbs: number }) {
  const seeker = role === "seeker";
  const Icon = seeker ? Flashlight : Footprints;
  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center p-6 animate-fade-in",
        seeker
          ? "bg-[radial-gradient(ellipse_at_center,hsl(351_90%_22%),hsl(var(--background))_75%)]"
          : "bg-[radial-gradient(ellipse_at_center,hsl(156_80%_14%),hsl(var(--background))_75%)]",
      )}
    >
      <div className="max-w-sm text-center">
        <div className="relative mx-auto mb-8 h-36 w-36">
          <div className={cn("absolute inset-0 rounded-full animate-ring-out", seeker ? "border-4 border-neon-red" : "border-4 border-neon-mint")} />
          <div
            className={cn(
              "relative flex h-full w-full items-center justify-center rounded-full animate-pop-in",
              seeker ? "bg-neon-red/20 shadow-[0_0_80px_-10px_hsl(var(--seeker))]" : "bg-neon-mint/15 shadow-[0_0_80px_-10px_hsl(var(--runner))]",
            )}
          >
            <Icon className={cn("h-16 w-16", seeker ? "text-neon-red" : "text-neon-mint")} />
          </div>
        </div>
        <p className="mb-1 font-display text-sm font-bold uppercase tracking-[0.4em] text-muted-foreground animate-rise-in">You are</p>
        <h1
          className={cn(
            "font-display text-6xl font-bold uppercase animate-rise-in [animation-delay:80ms]",
            seeker ? "text-neon-red glow-text-red" : "text-neon-mint glow-text-mint",
          )}
          data-testid="text-role"
        >
          {seeker ? "The seeker" : "A runner"}
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-foreground/80 animate-rise-in [animation-delay:160ms]">
          {seeker
            ? `Count to 10 while they hide. Then catch them all, or stop them charging ${orbs} orbs (they glow brighter while charging) before time runs out.`
            : `${seekerName} is hunting. Scatter while the lights are on, then charge ${orbs} orbs as a team: stand on one until it pops.`}
        </p>
      </div>
    </div>
  );
}
