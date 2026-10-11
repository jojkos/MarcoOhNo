import { useEffect, useState } from "react";
import { navigate } from "wouter/use-browser-location";
import { Tv, Smartphone, ArrowRight, X, History, Loader2 } from "lucide-react";
import type { RoomStatus } from "@shared/protocol";
import { Logo, Screen, Panel, Chip } from "@/components/kit";
import { HowToPlay } from "@/components/game/common";
import { createRoom, roomStatus } from "@/lib/net";
import { forgetRoom, recentRooms, type RecentRoom } from "@/lib/storage";
import { unlockAudio } from "@/lib/sfx";
import { cn } from "@/lib/utils";

const PHASE_LABEL: Record<string, string> = {
  lobby: "In the lobby",
  reveal: "Round starting",
  scatter: "Round in progress",
  hunt: "Round in progress",
  round_over: "Between rounds",
};

function RecentCard({ room, status, onForget }: { room: RecentRoom; status: RoomStatus; onForget: () => void }) {
  const host = room.role === "host";
  const open = () => navigate(host ? `/tv/${room.code}` : `/play/${room.code}`);
  return (
    <div className="glass flex items-center gap-4 rounded-2xl p-3 pl-4 animate-rise-in">
      <div className={cn("flex h-11 w-11 items-center justify-center rounded-xl", host ? "bg-neon-cyan/15" : "bg-neon-mint/15")}>
        {host ? <Tv className="h-5 w-5 text-neon-cyan" /> : <Smartphone className="h-5 w-5 text-neon-mint" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-display font-bold">
          {host ? "Hosting" : room.name} <span className="font-mono tracking-widest text-muted-foreground">· {room.code}</span>
        </p>
        <p className="truncate text-sm text-muted-foreground">
          {PHASE_LABEL[status.phase ?? ""] ?? ""} · {status.players} player{status.players === 1 ? "" : "s"}
        </p>
      </div>
      <button
        onClick={open}
        className={cn(
          "inline-flex h-10 items-center gap-1.5 rounded-xl px-4 font-display text-sm font-bold uppercase tracking-wider transition hover:brightness-110 active:scale-95",
          host ? "bg-neon-cyan text-black" : "bg-neon-mint text-black",
        )}
        data-testid={`button-resume-${room.code}`}
      >
        {host ? "Reopen" : "Rejoin"} <ArrowRight className="h-4 w-4" />
      </button>
      <button onClick={onForget} className="rounded-lg p-2 text-muted-foreground hover:bg-white/5 hover:text-foreground" aria-label="Forget room">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function BigChoice({
  tone,
  icon: Icon,
  title,
  text,
  onClick,
  busy,
  testId,
}: {
  tone: "cyan" | "mint";
  icon: typeof Tv;
  title: string;
  text: string;
  onClick: () => void;
  busy?: boolean;
  testId: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={cn(
        "group glass relative overflow-hidden rounded-3xl p-6 text-left transition duration-200 hover:-translate-y-1 active:scale-[0.98] sm:p-8",
        tone === "cyan" ? "hover:border-neon-cyan/50" : "hover:border-neon-mint/50",
      )}
      data-testid={testId}
    >
      <div
        className={cn(
          "pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full blur-3xl transition-opacity duration-300 opacity-40 group-hover:opacity-80",
          tone === "cyan" ? "bg-neon-cyan/40" : "bg-neon-mint/40",
        )}
      />
      <div
        className={cn(
          "mb-5 flex h-14 w-14 items-center justify-center rounded-2xl",
          tone === "cyan" ? "bg-neon-cyan/15 text-neon-cyan" : "bg-neon-mint/15 text-neon-mint",
        )}
      >
        {busy ? <Loader2 className="h-7 w-7 animate-spin" /> : <Icon className="h-7 w-7" />}
      </div>
      <p className="font-display text-2xl font-bold uppercase tracking-wide">{title}</p>
      <p className="mt-1 text-muted-foreground">{text}</p>
      <ArrowRight
        className={cn(
          "absolute bottom-6 right-6 h-6 w-6 transition group-hover:translate-x-1 sm:bottom-8 sm:right-8",
          tone === "cyan" ? "text-neon-cyan" : "text-neon-mint",
        )}
      />
    </button>
  );
}

export function Home() {
  const [recent, setRecent] = useState<{ room: RecentRoom; status: RoomStatus }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Old QR codes used /?room=CODE.
    const legacy = new URLSearchParams(window.location.search).get("room");
    if (legacy) return navigate(`/join/${legacy.toUpperCase().slice(0, 4)}`, { replace: true });

    let alive = true;
    const rooms = recentRooms();
    Promise.all(rooms.map(async (room) => ({ room, status: await roomStatus(room.code) }))).then((list) => {
      if (!alive) return;
      list.filter((r) => !r.status.exists).forEach((r) => forgetRoom(r.room.code));
      setRecent(list.filter((r) => r.status.exists));
    });
    return () => {
      alive = false;
    };
  }, []);

  const host = async () => {
    unlockAudio();
    setBusy(true);
    setError(null);
    const res = await createRoom();
    setBusy(false);
    if ("error" in res) setError(res.error);
    else navigate(`/tv/${res.code}`);
  };

  return (
    <Screen className="mx-auto flex max-w-4xl flex-col items-center gap-10 py-10 sm:py-16">
      <div className="flex flex-col items-center text-center animate-rise-in">
        <Logo />
        <p className="mt-6 max-w-md text-lg text-muted-foreground">
          Hide-and-seek in the dark for 3 to 8 friends. The TV shows the seeker's flashlight, and your phone is your controller.
        </p>
      </div>

      {recent.length > 0 && (
        <div className="w-full max-w-2xl space-y-2">
          <p className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            <History className="h-3.5 w-3.5" /> Pick up where you left off
          </p>
          {recent.map((r) => (
            <RecentCard
              key={`${r.room.role}-${r.room.code}`}
              room={r.room}
              status={r.status}
              onForget={() => {
                forgetRoom(r.room.code);
                setRecent((list) => list.filter((x) => x.room.code !== r.room.code));
              }}
            />
          ))}
        </div>
      )}

      <div className="grid w-full gap-4 sm:grid-cols-2 animate-rise-in [animation-delay:100ms]">
        <BigChoice
          tone="cyan"
          icon={Tv}
          title="Host a game"
          text="Open this on the TV or laptop everyone can see."
          onClick={host}
          busy={busy}
          testId="card-create-game"
        />
        <BigChoice
          tone="mint"
          icon={Smartphone}
          title="Join a game"
          text="Got a room code? Your phone becomes the controller."
          onClick={() => navigate("/join")}
          testId="card-join-game"
        />
      </div>
      {error && <Chip className="border-neon-red/40 text-neon-red">{error}</Chip>}

      <Panel className="w-full p-5 sm:p-6">
        <p className="mb-4 font-display text-sm font-bold uppercase tracking-[0.25em] text-muted-foreground">How to play</p>
        <HowToPlay />
      </Panel>
    </Screen>
  );
}
