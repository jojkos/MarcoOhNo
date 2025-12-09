import React from "react";

export const Logo = () => {
    return (
        <svg width="400" height="200" viewBox="0 0 600 300" xmlns="http://www.w3.org/2000/svg" className="w-full max-w-md mx-auto drop-shadow-2xl">
            <defs>
                <linearGradient id="beamGradient" x1="0%" y1="50%" x2="100%" y2="50%">
                    <stop offset="0%" style={{ stopColor: "rgba(255, 255, 200, 0.9)", stopOpacity: 1 }} />
                    <stop offset="100%" style={{ stopColor: "rgba(255, 255, 100, 0)", stopOpacity: 0 }} />
                </linearGradient>

                <filter id="glow">
                    <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
                    <feMerge>
                        <feMergeNode in="coloredBlur" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>
            </defs>

            <path d="M 335 115 L 580 50 L 580 180 Z" fill="url(#beamGradient)" opacity="0.6" />

            <text x="50" y="150" fontFamily="'Arial Black', 'Helvetica Black', sans-serif" fontWeight="900" fontSize="80" fill="#ffffff" letterSpacing="-2">
                MARC<tspan fill="#ffffaa" filter="url(#glow)">O</tspan>
            </text>

            <g transform="translate(400, 130) rotate(5)">
                <text x="0" y="0" fontFamily="'Courier New', monospace" fontWeight="bold" fontSize="50" fill="#ff4444" style={{ textShadow: "2px 2px 0px #000" }}>
                    OH NO
                </text>
                <circle cx="95" cy="-35" r="4" fill="white" />
                <circle cx="115" cy="-35" r="4" fill="white" />
                <circle cx="94" cy="-35" r="1.5" fill="black" />
                <circle cx="114" cy="-35" r="1.5" fill="black" />
            </g>
        </svg>
    );
};
