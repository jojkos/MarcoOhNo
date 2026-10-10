import { Flashlight, Ghost, Lock, Sparkles, WifiOff } from "lucide-react";
import type { LobbyPlayer, SnapPlayer } from "@shared/protocol";
import { SEEKER_COLOR } from "@shared/config";

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

export function Avatar({ player, size = 40, seeker = false }: { player: LobbyPlayer; size?: number; seeker?: boolean }) {
  return (
    <div
      className="rounded-full flex items-center justify-center text-white font-bold shrink-0 border-2 border-white/30"
      style={{
        backgroundColor: seeker ? SEEKER_COLOR : player.color,
        width: size,
        height: size,
        fontSize: size * 0.45,
        opacity: player.connected ? 1 : 0.4,
      }}
    >
      {player.name.charAt(0).toUpperCase()}
    </div>
  );
}

export function StatusIcon({ p, connected }: { p?: SnapPlayer; connected: boolean }) {
  if (!connected) return <WifiOff className="w-4 h-4 text-muted-foreground" />;
  if (!p) return null;
  if (p.role === "seeker") return <Flashlight className="w-4 h-4 text-game-seeker" />;
  if (p.status === "caged") return <Lock className="w-4 h-4 text-orange-300" />;
  if (p.status === "ghost") return <Ghost className="w-4 h-4 text-muted-foreground" />;
  return <Sparkles className="w-4 h-4 text-game-runner" />;
}

export function OrbMeter({ collected, need, large = false }: { collected: number; need: number; large?: boolean }) {
  const pips = Array.from({ length: need }, (_, i) => i < collected);
  return (
    <div className="flex items-center gap-2">
      <div className={`flex flex-wrap gap-1 ${large ? "max-w-[260px]" : "max-w-[120px]"}`}>
        {pips.map((on, i) => (
          <div
            key={i}
            className={`rounded-full ${large ? "w-4 h-4" : "w-2.5 h-2.5"} ${
              on ? "bg-yellow-300 shadow-[0_0_8px_rgba(255,212,59,0.9)]" : "bg-white/15"
            }`}
          />
        ))}
      </div>
      <span className={`font-display tabular-nums ${large ? "text-2xl" : "text-sm"}`}>
        {collected}/{need}
      </span>
    </div>
  );
}

export function HowToPlay({ compact = false }: { compact?: boolean }) {
  const items = [
    {
      title: "Runners",
      color: "text-game-runner",
      text: "You get 10 seconds to scatter while the lights are on. Then it goes dark: collect the glowing orbs together before time runs out, and stay out of the flashlight. Dash to escape.",
    },
    {
      title: "Seeker",
      color: "text-game-seeker",
      text: "Keep a runner in your flashlight to catch them. Shout POLO to make every runner give away roughly where they are. You win if everyone is caught, or if the orbs aren't collected in time.",
    },
    {
      title: "Caught?",
      color: "text-orange-300",
      text: "The first catch locks you in a cage. A teammate who stands next to you sets you free. Get caught again and you become a ghost: float through walls and BOO to trick the seeker with fake noises.",
    },
  ];
  return (
    <div className={`grid gap-3 ${compact ? "grid-cols-1" : "md:grid-cols-3"}`}>
      {items.map((it) => (
        <div key={it.title} className="rounded-lg bg-white/5 border border-white/10 p-3">
          <p className={`font-display text-sm tracking-wider mb-1 ${it.color}`}>{it.title.toUpperCase()}</p>
          <p className="text-sm text-muted-foreground leading-snug">{it.text}</p>
        </div>
      ))}
    </div>
  );
}
