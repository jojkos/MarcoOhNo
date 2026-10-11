import { Flashlight, Ghost, Lock, WifiOff, Footprints, HeartHandshake } from "lucide-react";
import type { SnapPlayer } from "@shared/protocol";
import { cn } from "@/lib/utils";

export function formatTime(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Base URL phones should open. On localhost, swap in the machine's LAN address. */
export async function joinBase(): Promise<string> {
  const { hostname, origin, protocol } = window.location;
  if (hostname !== "localhost" && hostname !== "127.0.0.1") return origin;
  try {
    const res = await fetch("/api/lan");
    const { ips, port } = (await res.json()) as { ips: string[]; port: number };
    if (ips.length) return `${protocol}//${ips[0]}:${port}`;
  } catch {
    /* fall through */
  }
  return origin;
}

export function StatusIcon({ p, connected, className }: { p?: SnapPlayer; connected: boolean; className?: string }) {
  const c = cn("h-4 w-4", className);
  if (!connected) return <WifiOff className={cn(c, "text-muted-foreground")} />;
  if (!p) return null;
  if (p.role === "seeker") return <Flashlight className={cn(c, "text-neon-red")} />;
  if (p.status === "caged") return <Lock className={cn(c, "text-neon-orange")} />;
  if (p.status === "ghost") return <Ghost className={cn(c, "text-muted-foreground")} />;
  return <Footprints className={cn(c, "text-neon-mint")} />;
}

export function OrbMeter({ collected, need, large = false }: { collected: number; need: number; large?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={cn("flex flex-wrap justify-end gap-1", large ? "max-w-[280px]" : "max-w-[110px]")}>
        {Array.from({ length: need }, (_, i) => (
          <div
            key={i}
            className={cn(
              "rounded-full transition-all duration-300",
              large ? "h-4 w-4" : "h-2.5 w-2.5",
              i < collected ? "bg-neon-gold shadow-[0_0_10px_2px_hsl(var(--orb)/0.7)]" : "border border-white/15 bg-white/[0.12]",
            )}
          />
        ))}
      </div>
      <span className={cn("font-display font-bold tabular-nums", large ? "text-2xl" : "text-sm")}>
        {collected}/{need}
      </span>
    </div>
  );
}

const RULES = [
  {
    icon: Footprints,
    title: "Runners",
    tone: "text-neon-mint",
    ring: "from-neon-mint/25",
    text: "You get 10 seconds to scatter while the lights are on. Then it goes dark: grab the glowing orbs as a team before time runs out. Stay out of the flashlight, and Dash to escape.",
  },
  {
    icon: Flashlight,
    title: "Seeker",
    tone: "text-neon-red",
    ring: "from-neon-red/25",
    text: "Keep a runner in your beam to catch them. Shout POLO and every runner gives away roughly where they are. You win when nobody is left free, or when time runs out.",
  },
  {
    icon: HeartHandshake,
    title: "Caught?",
    tone: "text-neon-orange",
    ring: "from-neon-orange/25",
    text: "The first catch locks you in a cage until a teammate stands next to you and sets you free. Get caught again and you're a ghost: float through walls and BOO to fool the seeker.",
  },
];

export function HowToPlay({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("grid gap-3", compact ? "grid-cols-1" : "md:grid-cols-3")}>
      {RULES.map((r, i) => (
        <div
          key={r.title}
          className="glass relative overflow-hidden rounded-2xl p-4 animate-rise-in"
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <div className={cn("pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br to-transparent blur-2xl", r.ring)} />
          <div className="mb-2 flex items-center gap-2">
            <r.icon className={cn("h-5 w-5", r.tone)} />
            <p className={cn("font-display text-sm font-bold uppercase tracking-[0.2em]", r.tone)}>{r.title}</p>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">{r.text}</p>
        </div>
      ))}
    </div>
  );
}
