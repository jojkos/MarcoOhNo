import { Music, Music2, Volume2, VolumeX } from "lucide-react";
import { audioSettings, useAudioPrefs } from "@/audio/settings";
import { cn } from "@/lib/utils";

/** Music on/off + sound effects on/off. */
export function SoundToggle({ className }: { className?: string }) {
  const prefs = useAudioPrefs();
  const btn = "rounded-full p-2 text-muted-foreground transition hover:bg-white/5 hover:text-foreground";
  return (
    <div className={cn("flex items-center", className)}>
      <button
        className={btn}
        onClick={() => audioSettings.set({ music: prefs.music > 0 ? 0 : 0.7 })}
        aria-label={prefs.music > 0 ? "Turn music off" : "Turn music on"}
        data-testid="button-music"
      >
        {prefs.music > 0 ? <Music className="h-5 w-5" /> : <Music2 className="h-5 w-5 opacity-40" />}
      </button>
      <button
        className={btn}
        onClick={() => audioSettings.set({ sfx: prefs.sfx > 0 ? 0 : 0.9 })}
        aria-label={prefs.sfx > 0 ? "Mute sounds" : "Unmute sounds"}
        data-testid="button-sfx"
      >
        {prefs.sfx > 0 ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5 opacity-40" />}
      </button>
    </div>
  );
}
