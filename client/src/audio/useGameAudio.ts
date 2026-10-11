import { useEffect } from "react";
import { PLAYER, RULES } from "@shared/config";
import type { FxEvent } from "@shared/protocol";
import { getRoom, onFx } from "@/lib/session";
import { useGameStore } from "@/lib/gameStore";
import { exposureTone, playSfx, warmSfx, type SfxName } from "./sfx";
import { setMusic, startMusic } from "./music";
import { haptic } from "./haptics";

type View = "tv" | "mobile";

function panFor(x: number) {
  const w = getRoom()?.state.round?.width ?? 1;
  return ((x / w) * 2 - 1) * 0.75;
}

function meId() {
  return useGameStore.getState().playerId;
}

function myRole() {
  const id = meId();
  return id ? getRoom()?.state.players.get(id)?.role : undefined;
}

/** Which sounds each screen plays for an event. TV = room audio; phones = personal. */
function onEvents(view: View, events: FxEvent[]) {
  const me = meId();
  const seekerSide = view === "tv" || myRole() === "seeker";
  const play = (name: SfxName, x?: number, gain = 1) => playSfx(name, { pan: view === "tv" && x !== undefined ? panFor(x) : 0, gain });
  for (const e of events) {
    switch (e.k) {
      case "polo":
        if (seekerSide) play("marco");
        if (me && e.targets.includes(me)) {
          play("polo");
          haptic.alert();
        }
        break;
      case "noise":
        if (seekerSide) play(e.why === "locker" ? "creak" : e.why === "sneeze" ? "sneeze" : "noise", e.x);
        else if (e.why === "sneeze") {
          const p = me ? getRoom()?.state.players.get(me) : undefined;
          if (p && Math.hypot(p.x - e.x, p.y - e.y) < 30) play("sneeze"); // that was you!
        }
        break;
      case "caught":
        if (e.id === me) {
          play("caught");
          haptic.caught();
        } else if (view === "tv" || e.by === me) play("caught", e.x);
        else play("caught", e.x, 0.4);
        if (e.ghost && (view === "tv" || e.id === me)) play("ghost", e.x, 0.6);
        break;
      case "freed":
        if (e.id === me || e.by === me) {
          play("freed");
          haptic.freed();
        } else if (view === "tv") play("freed", e.x);
        break;
      case "orb":
        play("orb", e.x, view === "tv" || e.by === me ? 1 : 0.5);
        if (e.by === me) haptic.bump();
        break;
      case "item":
        if (e.id === me) {
          play("item");
          haptic.bump();
        } else if (view === "tv") play("item", e.x, 0.4);
        break;
      case "use": {
        const mine = e.id === me;
        const map: Partial<Record<typeof e.item, SfxName>> = { dash: "dash", sprint: "sprint", smoke: "smoke", decoy: "decoy", flare: "flare", trap: "trapSet", boo: "boo" };
        const name = map[e.item];
        if (name && (mine || (view === "tv" && e.item !== "trap"))) play(name, e.x, mine ? 1 : 0.7);
        break;
      }
      case "flash":
        play("flash", e.x);
        break;
      case "decoyPop":
        if (seekerSide) play("pop", e.x);
        break;
      case "locker":
        if (e.what === "found") play("found");
        else if (e.what === "empty" && seekerSide) play("empty");
        else if (e.what === "search" && seekerSide) play("search");
        else if ((e.what === "enter" || e.what === "exit") && view === "mobile" && myRole() === "runner") {
          const p = me ? getRoom()?.state.players.get(me) : undefined;
          if (p && (p.locker === e.id || e.what === "exit")) play("door");
        }
        break;
      case "help":
        // Only free runners can answer a call for help.
        if (view === "tv" || (myRole() === "runner" && e.id !== me && getRoom()?.state.players.get(me ?? "")?.status === "free")) {
          play("help", e.x);
          if (view === "mobile") haptic.alert();
        }
        break;
      case "trapped":
        if (e.id === me) {
          play("trapped");
          haptic.alert();
        } else if (seekerSide) play("trapped", e.x);
        break;
    }
  }
}

/** Sound + music for a room screen. Mount once per page. */
export function useGameAudio(view: View) {
  useEffect(() => {
    const gesture = () => {
      void startMusic();
      warmSfx();
    };
    window.addEventListener("pointerdown", gesture);
    window.addEventListener("keydown", gesture);
    const unFx = onFx((events) => onEvents(view, events));

    // Seeded on the first sample: (re)opening mid-hunt or on the results must not replay stingers.
    let lastPhase: string | null = null;
    let lastSecond = -1;
    let lastBeat = 0;
    let lastCharge = 0;
    const id = setInterval(() => {
      const s = getRoom()?.state;
      if (!s) return setMusic(view === "tv" ? "lobby" : "off");
      const phase = s.phase;
      const me = meId() ? s.players.get(meId()!) : undefined;

      // Phase stingers.
      if (lastPhase === null) lastPhase = phase;
      if (phase !== lastPhase) {
        if (phase === "hunt") {
          playSfx("go");
          if (me?.role === "runner") haptic.go();
        }
        if (phase === "round_over" && s.result) {
          try {
            const r = JSON.parse(s.result);
            // Players who sat the round out get no win/lose sting (their role is from an old round).
            if (r.winner !== "aborted" && (view === "tv" || me?.inRound)) {
              const won = me ? (me.role === "seeker") === (r.winner === "seeker") : true;
              playSfx(won ? "win" : "lose");
            }
          } catch {
            /* ignore */
          }
        }
        lastPhase = phase;
      }
      if (phase === "scatter" || (phase === "hunt" && s.phaseLeft < 10500)) {
        const sec = Math.ceil(s.phaseLeft / 1000);
        if (sec !== lastSecond && sec <= (phase === "scatter" ? 5 : 10)) playSfx("tick", { gain: phase === "hunt" ? 0.7 : 1 });
        lastSecond = sec;
      }

      // Music: the TV carries the soundtrack (phones only if enabled in settings).
      let danger = 0;
      s.players.forEach((p) => (danger = Math.max(danger, p.exposure)));
      if (phase === "lobby" || phase === "round_over") setMusic("lobby");
      else if (phase === "reveal" || phase === "scatter") setMusic("tension");
      else {
        const elapsed = 1 - s.phaseLeft / RULES.huntMs;
        setMusic("hunt", 0.25 + elapsed * 0.45 + danger * 0.3, s.phaseLeft < 30000);
      }

      // Personal tension on runner phones: heartbeat + exposure whine.
      if (view === "mobile" && me && me.role === "runner" && me.status === "free" && phase === "hunt" && me.locker < 0) {
        exposureTone(me.exposure);
        // Rising blips while you charge an orb.
        let charging = -1;
        s.orbs.forEach((o) => {
          if (o.charge > 0 && Math.hypot(o.x - me.x, o.y - me.y) <= RULES.orbRadius + PLAYER.radius + 4) charging = o.charge / 100;
        });
        if (charging >= 0 && performance.now() - lastCharge > 180 - charging * 80) {
          lastCharge = performance.now();
          playSfx("charge", { rate: 0.8 + charging * 0.9 });
          haptic.tap();
        }
        const seeker = s.round ? s.players.get(s.round.seekerId) : undefined;
        if (seeker) {
          const d = Math.hypot(seeker.x - me.x, seeker.y - me.y);
          const threat = Math.max(0, Math.min(1, 1 - (d - 110) / 380));
          const interval = 1100 - 750 * threat;
          const now = performance.now();
          if (threat > 0 && now - lastBeat > interval) {
            lastBeat = now;
            playSfx("heartbeat", { gain: 0.35 + threat * 0.65 });
            haptic.heartbeat(threat);
          }
        }
      } else exposureTone(0);
    }, 100);

    return () => {
      window.removeEventListener("pointerdown", gesture);
      window.removeEventListener("keydown", gesture);
      unFx();
      clearInterval(id);
      exposureTone(0);
      setMusic("off");
    };
  }, [view]);
}
