import { useEffect, useState } from "react";
import { navigate } from "wouter/use-browser-location";
import { UserRound, Loader2, CheckCircle2, AlertTriangle, Hourglass } from "lucide-react";
import type { RoomStatus } from "@shared/protocol";
import { Screen, Panel, Btn, CodeInput, TextField, BackButton, Logo } from "@/components/kit";
import { joinRoom, roomStatus } from "@/lib/session";
import { saveFace, savedFace, savedName, seatFor } from "@/lib/storage";
import { FACES } from "@shared/config";
import { Blob } from "@/components/game/Blob";
import { unlockAudio } from "@/audio/sfx";

function goBack() {
  if (window.history.length > 1) window.history.back();
  else navigate("/");
}

function StatusLine({ code, status }: { code: string; status: RoomStatus | null | "loading" }) {
  if (code.length < 4) return <p className="h-5 text-sm text-muted-foreground">Ask the host for the 4-letter code on the TV.</p>;
  if (status === "loading" || !status)
    return (
      <p className="flex h-5 items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Looking for room…
      </p>
    );
  if (!status.exists)
    return (
      <p className="flex h-5 items-center gap-2 text-sm text-neon-red" data-testid="text-room-status">
        <AlertTriangle className="h-4 w-4" /> No room with this code
      </p>
    );
  if (!status.joinable)
    return (
      <p className="flex h-5 items-center gap-2 text-sm text-neon-gold" data-testid="text-room-status">
        <Hourglass className="h-4 w-4" /> Round in progress: you can join when it ends
      </p>
    );
  return (
    <p className="flex h-5 items-center gap-2 text-sm text-neon-mint" data-testid="text-room-status">
      <CheckCircle2 className="h-4 w-4" /> Room found ·{" "}
      {status.players ? `${status.players} player${status.players === 1 ? "" : "s"} waiting` : "be the first one in"}
    </p>
  );
}

export function Join({ initialCode }: { initialCode?: string }) {
  const [code, setCode] = useState((initialCode ?? "").toUpperCase().slice(0, 4));
  const [name, setName] = useState(savedName());
  const [face, setFace] = useState(savedFace());
  const [status, setStatus] = useState<RoomStatus | null | "loading">(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asNew, setAsNew] = useState(false);
  const seat = code.length === 4 ? seatFor(code) : null;

  useEffect(() => {
    setError(null);
    if (code.length < 4) return setStatus(null);
    setStatus("loading");
    let alive = true;
    roomStatus(code).then((s) => alive && setStatus(s));
    return () => {
      alive = false;
    };
  }, [code]);

  const join = async () => {
    unlockAudio();
    setBusy(true);
    setError(null);
    saveFace(face);
    const res = await joinRoom(code, name.trim(), face);
    setBusy(false);
    if (res.ok) navigate(`/play/${res.code}`, { replace: true });
    else setError(res.error);
  };

  const canJoin = code.length === 4 && name.trim().length > 0 && !busy && status !== "loading" && (status === null || status.exists);

  return (
    <Screen className="mx-auto flex max-w-md flex-col gap-6 py-6" beam={false}>
      <div className="flex items-center justify-between">
        <BackButton onClick={goBack} />
        <Logo size="sm" />
        <div className="w-16" />
      </div>

      <Panel className="space-y-5 p-6 animate-rise-in">
        <h1 className="font-display text-2xl font-bold uppercase tracking-wide">Join a game</h1>
        <CodeInput value={code} onChange={setCode} autoFocus={!initialCode} />
        <StatusLine code={code} status={status} />

        {seat && !asNew ? (
          <div className="space-y-3 rounded-2xl border border-neon-mint/30 bg-neon-mint/[0.06] p-4">
            <p className="text-sm text-muted-foreground">You were already in this room as</p>
            <p className="font-display text-2xl font-bold">{seat.name}</p>
            <Btn tone="mint" size="lg" block onClick={() => navigate(`/play/${code}`, { replace: true })} data-testid="button-rejoin">
              Rejoin as {seat.name}
            </Btn>
            <button onClick={() => setAsNew(true)} className="w-full text-sm text-muted-foreground underline-offset-4 hover:underline">
              Join as someone else
            </button>
          </div>
        ) : (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (canJoin) join();
            }}
          >
            <TextField
              label="Your name"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 12))}
              placeholder="Name"
              autoFocus={!!initialCode}
              maxLength={12}
              enterKeyHint="go"
              data-testid="input-player-name"
            />
            <div>
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Pick a face</span>
              <div className="grid grid-cols-8 gap-1">
                {FACES.map((f, i) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFace(i)}
                    className={`flex items-center justify-center rounded-xl p-1 transition ${face === i ? "bg-white/10 ring-2 ring-neon-mint" : "opacity-60 hover:opacity-100"}`}
                    aria-label={f}
                    data-testid={`face-${f}`}
                  >
                    <Blob color="#4ade80" face={i} size={34} glow={face === i} />
                  </button>
                ))}
              </div>
            </div>
            {error && (
              <p className="flex items-center gap-2 rounded-xl bg-neon-red/10 px-3 py-2 text-sm text-neon-red" data-testid="text-error">
                <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
              </p>
            )}
            <Btn tone="mint" size="lg" block icon={busy ? Loader2 : UserRound} disabled={!canJoin} type="submit" data-testid="button-join">
              {busy ? "Joining…" : "Join"}
            </Btn>
          </form>
        )}
      </Panel>
    </Screen>
  );
}
