import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import type { LobbyPlayer } from "@shared/protocol";
import { SEEKER_COLOR } from "@shared/config";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------ backdrop

/** Animated scene behind menus: blueprint grid, a sweeping flashlight, drifting orbs. */
export function Backdrop({ beam = true }: { beam?: boolean }) {
  const orbs = [
    { left: "12%", top: "22%", delay: "0s", size: 10 },
    { left: "82%", top: "18%", delay: "-2s", size: 8 },
    { left: "70%", top: "72%", delay: "-4s", size: 12 },
    { left: "22%", top: "78%", delay: "-1s", size: 7 },
    { left: "48%", top: "88%", delay: "-5s", size: 9 },
  ];
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-10%,hsl(230_60%_14%),hsl(var(--background))_60%)]" />
      <div className="absolute inset-0 grid-bg [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]" />
      {beam && (
        <div className="absolute left-1/2 -top-[10vh] h-[130vh] w-[130vh] -translate-x-1/2 origin-top animate-sweep">
          <div className="h-full w-full bg-[conic-gradient(from_160deg_at_50%_0%,transparent_0deg,hsl(48_100%_70%/0.13)_12deg,hsl(48_100%_75%/0.2)_20deg,hsl(48_100%_70%/0.13)_28deg,transparent_40deg)] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
        </div>
      )}
      {orbs.map((o, i) => (
        <div
          key={i}
          className="absolute rounded-full bg-neon-gold animate-float"
          style={{
            left: o.left,
            top: o.top,
            width: o.size,
            height: o.size,
            animationDelay: o.delay,
            boxShadow: "0 0 18px 6px hsl(var(--orb) / 0.45)",
          }}
        />
      ))}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgb(0_0_0/0.75))]" />
    </div>
  );
}

// ------------------------------------------------------------------ logo

export function Logo({ size = "lg" }: { size?: "sm" | "lg" }) {
  const lens = (
    <span className="relative ml-[0.04em] inline-block h-[0.62em] w-[0.62em] rounded-full">
      <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_40%_40%,#fffbe0,#ffd84a_45%,#ff9f1a_80%)] shadow-[0_0_30px_8px_rgba(255,214,74,0.55)]" />
      <span className="absolute inset-[22%] rounded-full bg-white/70 blur-[2px]" />
    </span>
  );
  if (size === "sm") {
    // Compact single-row mark for headers.
    return (
      <div className="inline-flex select-none items-center gap-2 font-display text-2xl font-bold leading-none">
        <span className="flex items-center tracking-tight">MARC{lens}</span>
        <span className="-rotate-3 rounded bg-neon-red px-1.5 py-0.5 text-xs tracking-wider text-white shadow-[0_0_20px_-4px_hsl(var(--seeker)/0.8)]">
          OH NO!
        </span>
      </div>
    );
  }
  return (
    <div className="relative inline-flex select-none flex-col items-center font-display text-6xl font-bold leading-none sm:text-7xl md:text-8xl">
      <div className="flex items-center tracking-tight">MARC{lens}</div>
      <div className="mt-[0.12em] -rotate-3 rounded-md bg-neon-red px-[0.3em] py-[0.06em] text-[0.42em] tracking-wider text-white shadow-[0_0_30px_-4px_hsl(var(--seeker)/0.8)]">
        OH NO!
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ layout

export function Screen({ children, className, beam = true }: { children: ReactNode; className?: string; beam?: boolean }) {
  return (
    <div className="relative h-full overflow-y-auto">
      <Backdrop beam={beam} />
      <div className={cn("relative z-10 min-h-full safe-pad", className)}>{children}</div>
    </div>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("glass rounded-3xl", className)}>{children}</div>;
}

export function BackButton({ onClick, label = "Back" }: { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-white/5 transition"
      data-testid="button-back"
    >
      <ArrowLeft className="h-4 w-4" />
      {label}
    </button>
  );
}

// ------------------------------------------------------------------ buttons

type Tone = "cyan" | "mint" | "red" | "gold" | "violet" | "ghost";

const TONES: Record<Tone, string> = {
  cyan: "text-[#04111a] bg-[linear-gradient(135deg,#7cf0ff,#20b8ff)] shadow-[0_10px_30px_-8px_rgba(32,184,255,0.7)]",
  mint: "text-[#03140d] bg-[linear-gradient(135deg,#9dffd8,#22e39a)] shadow-[0_10px_30px_-8px_rgba(34,227,154,0.7)]",
  red: "text-white bg-[linear-gradient(135deg,#ff6b81,#ff2d4f)] shadow-[0_10px_30px_-8px_rgba(255,45,79,0.75)]",
  gold: "text-[#1a1203] bg-[linear-gradient(135deg,#ffe58a,#ffbe1a)] shadow-[0_10px_30px_-8px_rgba(255,190,26,0.7)]",
  violet: "text-white bg-[linear-gradient(135deg,#c89bff,#8a4dff)] shadow-[0_10px_30px_-8px_rgba(138,77,255,0.75)]",
  ghost: "text-foreground bg-white/[0.06] border border-white/10 hover:bg-white/[0.1]",
};

const SIZES = {
  sm: "h-9 px-4 text-sm rounded-xl gap-1.5",
  md: "h-12 px-6 text-base rounded-2xl gap-2",
  lg: "h-14 px-8 text-lg rounded-2xl gap-2.5",
  xl: "h-20 px-12 text-2xl rounded-3xl gap-3",
};

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: Tone;
  size?: keyof typeof SIZES;
  icon?: LucideIcon;
  block?: boolean;
}

export const Btn = forwardRef<HTMLButtonElement, BtnProps>(function Btn(
  { tone = "cyan", size = "md", icon: Icon, block, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "relative inline-flex select-none items-center justify-center font-display font-bold uppercase tracking-wider transition duration-150",
        "hover:brightness-110 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none disabled:shadow-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        TONES[tone],
        SIZES[size],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {Icon && <Icon className={size === "xl" ? "h-7 w-7" : size === "sm" ? "h-4 w-4" : "h-5 w-5"} />}
      {children}
    </button>
  );
});

// ------------------------------------------------------------------ inputs

export function TextField({
  label,
  className,
  ...rest
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">{label}</span>
      <input
        className={cn(
          "h-14 w-full rounded-2xl border border-white/10 bg-black/40 px-4 text-center text-xl font-semibold outline-none transition",
          "placeholder:text-white/20 focus:border-neon-cyan/70 focus:shadow-[0_0_0_4px_hsl(var(--primary)/0.15)]",
          className,
        )}
        {...rest}
      />
    </label>
  );
}

/** Four big letter boxes backed by one input (paste and autofill friendly). */
export function CodeInput({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const chars = value.padEnd(4, " ").slice(0, 4).split("");
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Room code</span>
      <div className="relative">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4))}
          autoFocus={autoFocus}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          className="peer absolute inset-0 z-10 w-full cursor-text opacity-0"
          aria-label="Room code"
          data-testid="input-room-code"
        />
        <div className="grid grid-cols-4 gap-2.5">
          {chars.map((c, i) => {
            const active = i === Math.min(value.length, 3);
            return (
              <div
                key={i}
                className={cn(
                  "flex h-16 items-center justify-center rounded-2xl border bg-black/40 font-mono text-4xl font-extrabold transition",
                  c.trim() ? "border-neon-cyan/50 text-neon-cyan glow-text-cyan" : "border-white/10 text-white/15",
                  active && "peer-focus:border-neon-cyan peer-focus:shadow-[0_0_0_4px_hsl(var(--primary)/0.15)]",
                )}
              >
                {c.trim() || "•"}
              </div>
            );
          })}
        </div>
      </div>
    </label>
  );
}

// ------------------------------------------------------------------ players

export function Avatar({
  player,
  size = 40,
  seeker = false,
  className,
}: {
  player: Pick<LobbyPlayer, "name" | "color" | "connected">;
  size?: number;
  seeker?: boolean;
  className?: string;
}) {
  const color = seeker ? SEEKER_COLOR : player.color;
  return (
    <div
      className={cn("relative flex shrink-0 items-center justify-center rounded-full font-display font-bold text-white", className)}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.44,
        background: `radial-gradient(circle at 35% 30%, ${color}ee, ${color}88 70%)`,
        boxShadow: player.connected ? `0 0 ${size * 0.45}px -${size * 0.12}px ${color}, inset 0 0 0 2px rgb(255 255 255 / 0.25)` : undefined,
        opacity: player.connected ? 1 : 0.35,
        textShadow: "0 1px 2px rgb(0 0 0 / 0.5)",
      }}
    >
      {player.name.charAt(0).toUpperCase()}
    </div>
  );
}

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs font-semibold", className)}>
      {children}
    </span>
  );
}

/** Full-screen message with actions, e.g. "room ended". */
export function Notice({ icon: Icon, title, text, children }: { icon: LucideIcon; title: string; text?: ReactNode; children?: ReactNode }) {
  return (
    <Screen className="flex items-center justify-center">
      <Panel className="w-full max-w-md p-8 text-center animate-rise-in">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.06]">
          <Icon className="h-8 w-8 text-neon-cyan" />
        </div>
        <h1 className="font-display text-2xl font-bold">{title}</h1>
        {text && <p className="mt-2 text-muted-foreground">{text}</p>}
        {children && <div className="mt-6 flex flex-col gap-3">{children}</div>}
      </Panel>
    </Screen>
  );
}
