import { useEffect, useRef } from "react";
import { GameRenderer, type ViewKind } from "@/game/Renderer";

export function GameCanvas({ view }: { view: ViewKind }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const renderer = new GameRenderer(view);
    void renderer.init(ref.current);
    return () => renderer.destroy();
  }, [view]);
  return <div ref={ref} className="absolute inset-0 touch-none" data-testid={`game-canvas-${view}`} />;
}
