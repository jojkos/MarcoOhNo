import { useRef, useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Megaphone } from "lucide-react";
import { useGameStore } from "@/lib/gameStore";
import { socket } from "@/lib/socket";
import { MAP_CONFIG } from "@shared/schema";

interface MobileControlsProps {
  onMove: (dx: number, dy: number, angle: number) => void;
}

export function MobileControls({ onMove }: MobileControlsProps) {
  const { gameState, isSeeker, getPlayer } = useGameStore();
  const joystickRef = useRef<HTMLDivElement>(null);
  const [joystickActive, setJoystickActive] = useState(false);
  const [joystickPos, setJoystickPos] = useState({ x: 0, y: 0 });
  const [touchId, setTouchId] = useState<number | null>(null);
  
  const player = getPlayer();
  const isPlayerSeeker = isSeeker();
  const marcoOnCooldown = (gameState?.marcoCooldown || 0) > 0;
  const marcoCooldownProgress = Math.max(0, 100 - ((gameState?.marcoCooldown || 0) / MAP_CONFIG.marcoCooldown) * 100);

  const handleJoystickStart = useCallback((clientX: number, clientY: number, id?: number) => {
    if (!joystickRef.current) return;
    const rect = joystickRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    setJoystickActive(true);
    if (id !== undefined) setTouchId(id);
    
    const dx = (clientX - centerX) / (rect.width / 2);
    const dy = (clientY - centerY) / (rect.height / 2);
    const distance = Math.min(1, Math.sqrt(dx * dx + dy * dy));
    const angle = Math.atan2(dy, dx);
    
    setJoystickPos({
      x: Math.cos(angle) * distance * 30,
      y: Math.sin(angle) * distance * 30,
    });
    
    onMove(Math.cos(angle) * distance, Math.sin(angle) * distance, angle * (180 / Math.PI));
  }, [onMove]);

  const handleJoystickMove = useCallback((clientX: number, clientY: number, id?: number) => {
    if (!joystickActive || !joystickRef.current) return;
    if (id !== undefined && id !== touchId) return;
    
    const rect = joystickRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    const dx = (clientX - centerX) / (rect.width / 2);
    const dy = (clientY - centerY) / (rect.height / 2);
    const distance = Math.min(1, Math.sqrt(dx * dx + dy * dy));
    const angle = Math.atan2(dy, dx);
    
    setJoystickPos({
      x: Math.cos(angle) * distance * 30,
      y: Math.sin(angle) * distance * 30,
    });
    
    onMove(Math.cos(angle) * distance, Math.sin(angle) * distance, angle * (180 / Math.PI));
  }, [joystickActive, touchId, onMove]);

  const handleJoystickEnd = useCallback(() => {
    setJoystickActive(false);
    setJoystickPos({ x: 0, y: 0 });
    setTouchId(null);
    // Pass NaN for angle to signal that the existing angle should be preserved
    onMove(0, 0, Number.NaN);
  }, [onMove]);

  const handleMarco = () => {
    if (!marcoOnCooldown && isPlayerSeeker) {
      socket.emit("triggerMarco");
    }
  };

  useEffect(() => {
    const handleTouchMove = (e: TouchEvent) => {
      for (const touch of Array.from(e.touches)) {
        if (touch.identifier === touchId) {
          handleJoystickMove(touch.clientX, touch.clientY, touch.identifier);
          break;
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      let found = false;
      for (const touch of Array.from(e.touches)) {
        if (touch.identifier === touchId) {
          found = true;
          break;
        }
      }
      if (!found && joystickActive) {
        handleJoystickEnd();
      }
    };

    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd);
    window.addEventListener("touchcancel", handleTouchEnd);

    return () => {
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [touchId, joystickActive, handleJoystickMove, handleJoystickEnd]);

  return (
    <div className="absolute inset-x-0 bottom-0 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pointer-events-none z-20">
      <div className="flex items-end justify-between gap-4">
        <div 
          ref={joystickRef}
          className="w-32 h-32 rounded-full bg-muted/50 backdrop-blur-sm border-2 border-border/50 pointer-events-auto relative touch-none"
          onTouchStart={(e) => {
            e.preventDefault();
            const touch = e.touches[0];
            handleJoystickStart(touch.clientX, touch.clientY, touch.identifier);
          }}
          onMouseDown={(e) => handleJoystickStart(e.clientX, e.clientY)}
          onMouseMove={(e) => e.buttons === 1 && handleJoystickMove(e.clientX, e.clientY)}
          onMouseUp={handleJoystickEnd}
          onMouseLeave={() => joystickActive && handleJoystickEnd()}
          data-testid="control-joystick"
        >
          <div 
            className={`absolute w-16 h-16 rounded-full bg-primary/80 border-2 border-primary shadow-lg
              transition-transform ${joystickActive ? "" : "transition-all duration-150"}`}
            style={{
              left: "50%",
              top: "50%",
              transform: `translate(calc(-50% + ${joystickPos.x}px), calc(-50% + ${joystickPos.y}px))`,
            }}
          />
        </div>

        {isPlayerSeeker && (
          <div className="flex flex-col items-center gap-2 pointer-events-auto">
            <Button
              size="lg"
              variant={marcoOnCooldown ? "secondary" : "default"}
              disabled={marcoOnCooldown}
              onClick={handleMarco}
              className="w-20 h-20 rounded-full relative overflow-visible"
              data-testid="button-marco"
            >
              <Megaphone className="w-8 h-8" />
              {marcoOnCooldown && (
                <svg 
                  className="absolute inset-0 w-full h-full -rotate-90"
                  viewBox="0 0 100 100"
                >
                  <circle
                    cx="50"
                    cy="50"
                    r="46"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeDasharray={`${marcoCooldownProgress * 2.89} 289`}
                    className="text-primary opacity-50"
                  />
                </svg>
              )}
            </Button>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Marco
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
