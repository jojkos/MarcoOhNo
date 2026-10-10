import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { GameScene, type ViewKind } from "@/game/GameScene";

export function GameCanvas({ view }: { view: ViewKind }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const game = new Phaser.Game({
      type: Phaser.WEBGL,
      parent: ref.current,
      backgroundColor: "#04060b",
      scale: { mode: Phaser.Scale.RESIZE, width: "100%", height: "100%" },
      render: { antialias: true },
      fps: { target: 60 },
      input: { keyboard: false, mouse: false, touch: false },
      audio: { noAudio: true },
      banner: false,
    });
    game.scene.add("game", GameScene, true, { view });
    return () => game.destroy(true);
  }, [view]);

  return <div ref={ref} className="absolute inset-0" data-testid={`game-canvas-${view}`} />;
}
