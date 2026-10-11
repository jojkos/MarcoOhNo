import { useEffect, useState } from "react";
import { navigate } from "wouter/use-browser-location";
import { Loader2, DoorClosed, MonitorSmartphone, UserX } from "lucide-react";
import { useGameStore } from "@/lib/gameStore";
import { attachPlay, attachTv, createRoom, detach, retryAttach } from "@/lib/session";
import { forgetRoom, seatFor } from "@/lib/storage";
import { useGameAudio } from "@/audio/useGameAudio";
import { Btn, Notice, Screen } from "@/components/kit";
import { TVLobby } from "@/components/game/TVLobby";
import { TVGameView } from "@/components/game/TVGameView";
import { MobileLobby } from "@/components/game/MobileLobby";
import { MobileGameView } from "@/components/game/MobileGameView";

function Connecting({ code, text }: { code: string; text?: string }) {
  return (
    <Screen className="flex flex-col items-center justify-center gap-4 text-muted-foreground">
      <Loader2 className="h-10 w-10 animate-spin text-neon-cyan" />
      <p className="font-display uppercase tracking-[0.3em]">Room {code}</p>
      {text && <p className="text-sm">{text}</p>}
    </Screen>
  );
}

/** The shared screen: hosts the room if this browser created it, otherwise watches. */
export function TvPage({ code }: { code: string }) {
  const attachment = useGameStore((s) => s.attachment);
  const phase = useGameStore((s) => s.view?.phase);
  useGameAudio("tv");

  useEffect(() => {
    attachTv(code);
    return () => detach();
  }, [code]);

  if (attachment?.status === "error") {
    const { reason, message } = attachment.error!;
    if (reason === "kicked") {
      return (
        <Notice icon={MonitorSmartphone} title="Opened on another screen" text={message}>
          <Btn tone="cyan" onClick={retryAttach}>
            Use this screen instead
          </Btn>
          <Btn tone="ghost" onClick={() => navigate("/")}>
            Home
          </Btn>
        </Notice>
      );
    }
    return (
      <Notice icon={DoorClosed} title={`Room ${code} has ended`} text="Rooms close when everyone has been gone for a while, or when the server restarts.">
        <Btn
          tone="cyan"
          onClick={async () => {
            forgetRoom(code);
            const res = await createRoom();
            if ("code" in res) navigate(`/tv/${res.code}`, { replace: true });
          }}
          data-testid="button-new-room"
        >
          Start a new room
        </Btn>
        <Btn tone="ghost" onClick={() => navigate("/")}>
          Home
        </Btn>
      </Notice>
    );
  }

  if (!phase || !attachment || attachment.status === "connecting") return <Connecting code={code} />;
  return phase === "lobby" ? <TVLobby /> : <TVGameView />;
}

/** A player's phone. Needs a seat saved for this room, otherwise goes to the join form. */
export function PlayPage({ code }: { code: string }) {
  const attachment = useGameStore((s) => s.attachment);
  const phase = useGameStore((s) => s.view?.phase);
  // Checked once on entry: a seat dropped later (room gone) shows an error instead.
  const [hasSeat] = useState(() => !!seatFor(code));
  useGameAudio("mobile");

  useEffect(() => {
    if (!hasSeat) {
      navigate(`/join/${code}`, { replace: true });
      return;
    }
    attachPlay(code);
    return () => detach();
  }, [code, hasSeat]);

  if (attachment?.status === "error") {
    const { reason, message } = attachment.error!;
    if (reason === "kicked") {
      return (
        <Notice icon={MonitorSmartphone} title="Playing somewhere else" text={message}>
          <Btn tone="mint" onClick={retryAttach}>
            Play on this screen
          </Btn>
          <Btn tone="ghost" onClick={() => navigate("/")}>
            Home
          </Btn>
        </Notice>
      );
    }
    if (reason === "seat_expired" || reason === "no_seat") {
      return (
        <Notice icon={UserX} title="Your seat expired" text="You were away too long and the room let your seat go. Hop back in.">
          <Btn tone="mint" onClick={() => navigate(`/join/${code}`, { replace: true })} data-testid="button-join-again">
            Join again
          </Btn>
        </Notice>
      );
    }
    return (
      <Notice icon={DoorClosed} title={`Room ${code} has ended`} text={message}>
        <Btn tone="mint" onClick={() => navigate("/join", { replace: true })}>
          Join another room
        </Btn>
        <Btn tone="ghost" onClick={() => navigate("/")}>
          Home
        </Btn>
      </Notice>
    );
  }

  if (!phase || !attachment || attachment.status === "connecting") return <Connecting code={code} />;
  return phase === "lobby" ? <MobileLobby /> : <MobileGameView />;
}
