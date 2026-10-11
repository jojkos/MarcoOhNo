import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        lg: "0.75rem",
        md: "0.5rem",
        sm: "0.375rem",
      },
      colors: {
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--border) / <alpha-value>)",
        ring: "hsl(var(--primary) / <alpha-value>)",
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--background) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "hsl(var(--seeker) / <alpha-value>)",
          foreground: "hsl(0 0% 100% / <alpha-value>)",
        },
        neon: {
          cyan: "hsl(var(--primary) / <alpha-value>)",
          mint: "hsl(var(--runner) / <alpha-value>)",
          red: "hsl(var(--seeker) / <alpha-value>)",
          gold: "hsl(var(--orb) / <alpha-value>)",
          violet: "hsl(var(--polo) / <alpha-value>)",
          orange: "hsl(var(--cage) / <alpha-value>)",
        },
        // Semantic game colours (kept as aliases of the neon palette).
        game: {
          seeker: "hsl(var(--seeker) / <alpha-value>)",
          runner: "hsl(var(--runner) / <alpha-value>)",
          caught: "hsl(var(--muted-foreground) / <alpha-value>)",
          marco: "hsl(var(--polo) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["Outfit", "system-ui", "sans-serif"],
        display: ["'Chakra Petch'", "Outfit", "sans-serif"],
        game: ["Outfit", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "rise-in": {
          from: { opacity: "0", transform: "translateY(14px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pop-in": {
          "0%": { opacity: "0", transform: "scale(0.6)" },
          "70%": { opacity: "1", transform: "scale(1.06)" },
          "100%": { transform: "scale(1)" },
        },
        sweep: {
          "0%": { transform: "rotate(-28deg)" },
          "100%": { transform: "rotate(28deg)" },
        },
        float: {
          "0%, 100%": { transform: "translate(0, 0)" },
          "50%": { transform: "translate(6px, -14px)" },
        },
        glow: {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
        "ring-out": {
          from: { transform: "scale(0.6)", opacity: "0.9" },
          to: { transform: "scale(1.8)", opacity: "0" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.35s ease-out both",
        "rise-in": "rise-in 0.45s cubic-bezier(.2,.8,.2,1) both",
        "pop-in": "pop-in 0.45s cubic-bezier(.2,.8,.2,1) both",
        sweep: "sweep 9s ease-in-out infinite alternate",
        float: "float 7s ease-in-out infinite",
        glow: "glow 2.4s ease-in-out infinite",
        "ring-out": "ring-out 1.8s ease-out infinite",
        "pulse-fast": "pulse 0.6s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "pulse-slow": "pulse 2.2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
