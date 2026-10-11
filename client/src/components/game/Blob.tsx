import { useId } from "react";
import { FACES, SEEKER_COLOR } from "@shared/config";

/** SVG version of the in-game character: coloured blob with a face. */
export function Blob({
  color,
  face,
  size = 48,
  seeker = false,
  dim = false,
  glow = true,
}: {
  color: string;
  face: number;
  size?: number;
  seeker?: boolean;
  dim?: boolean;
  glow?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const fill = seeker ? SEEKER_COLOR : color;
  const f = FACES[face] ?? "happy";
  const dark = "#10131f";
  return (
    <svg
      viewBox="-24 -26 48 50"
      width={size}
      height={size}
      style={{ opacity: dim ? 0.4 : 1, filter: glow && !dim ? `drop-shadow(0 0 ${size / 6}px ${fill}aa)` : undefined }}
      className="shrink-0"
      aria-hidden
    >
      <defs>
        <radialGradient id={`g${id}`} cx="0.38" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="0.35" stopColor={fill} />
          <stop offset="1" stopColor={fill} stopOpacity="0.75" />
        </radialGradient>
      </defs>
      {f === "cat" && (
        <g fill={fill}>
          <polygon points="-16,-12 -13,-24 -4,-16" />
          <polygon points="16,-12 13,-24 4,-16" />
        </g>
      )}
      <circle r="18" fill={`url(#g${id})`} stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" />
      {seeker ? (
        <g>
          <rect x="-14" y="-9" width="28" height="10" rx="4" fill="#0b0d16" />
          <rect x="-10" y="-6" width="20" height="3" rx="1.5" fill="#ff3b5c" />
        </g>
      ) : (
        <g>
          <ellipse cx="-6.5" cy="-3" rx="4.6" ry="5.6" fill="#fff" />
          <ellipse cx="6.5" cy="-3" rx="4.6" ry="5.6" fill="#fff" />
          <circle cx="-5.5" cy="-2" r="2.5" fill={dark} />
          <circle cx="7.5" cy="-2" r="2.5" fill={dark} />
          {f === "cool" && (
            <g fill={dark}>
              <rect x="-12" y="-8" width="10" height="7" rx="2" />
              <rect x="2" y="-8" width="10" height="7" rx="2" />
              <rect x="-2" y="-6" width="4" height="1.6" />
            </g>
          )}
          {f === "nerd" && (
            <g fill="none" stroke={dark} strokeWidth="1.6">
              <circle cx="-6.5" cy="-3" r="5.5" />
              <circle cx="6.5" cy="-3" r="5.5" />
            </g>
          )}
          {f === "sleepy" && (
            <g fill={fill}>
              <rect x="-12" y="-9" width="11" height="5.5" />
              <rect x="1" y="-9" width="11" height="5.5" />
            </g>
          )}
        </g>
      )}
      <g fill="none" stroke={dark} strokeWidth="2" strokeLinecap="round">
        {f === "happy" && <path d="M -5 5 Q 0 10 5 5" />}
        {f === "grin" && <path d="M -6 4 Q 0 12 6 4 Z" fill={dark} />}
        {f === "wow" && <ellipse cx="0" cy="7" rx="2.6" ry="3.2" fill={dark} stroke="none" />}
        {f === "sly" && <path d="M -5 7 L 5 5" />}
        {f === "sleepy" && <path d="M -3 7 L 3 7" />}
        {f === "cool" && <path d="M -4 6 Q 0 9 5 5" />}
        {f === "nerd" && <path d="M -5 6 Q 0 10 5 6" />}
        {f === "cat" && <path d="M -4 6 Q -2 8 0 6 Q 2 8 4 6" strokeWidth="1.6" />}
      </g>
      {f === "happy" && (
        <g fill="#ff7aa8" opacity="0.55">
          <circle cx="-10" cy="4" r="2.4" />
          <circle cx="10" cy="4" r="2.4" />
        </g>
      )}
    </svg>
  );
}
