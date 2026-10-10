'use client';
import { useId } from 'react';

export type OrbState = 'idle' | 'connecting' | 'live' | 'muted';

// Glowing atom with orbiting comet trails, after the reference's "Speaking to AI" screen
export default function Orb({ state = 'idle', size = 260 }: { state?: OrbState; size?: number }) {
  const id = useId().replace(/:/g, '');
  const glow = `g${id}`, trail = `t${id}`, core = `c${id}`;
  return (
    <div className="orb" data-state={state} style={{ ['--orb' as string]: size + 'px' }} aria-hidden="true">
      <div className="glow" />
      <svg viewBox="0 0 200 200">
        <defs>
          <filter id={glow} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <linearGradient id={trail} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#5ad2f4" stopOpacity="0" />
            <stop offset=".7" stopColor="#5ad2f4" stopOpacity=".7" />
            <stop offset="1" stopColor="#c9f3ff" />
          </linearGradient>
          <radialGradient id={core}>
            <stop offset="0" stopColor="#ffffff" />
            <stop offset=".45" stopColor="#bdf0ff" />
            <stop offset="1" stopColor="#5ad2f4" stopOpacity="0" />
          </radialGradient>
        </defs>

        <g className="swirl" filter={`url(#${glow})`}>
          {[0, 120, 240].map((r) => (
            <g key={r} transform={`rotate(${r} 100 100)`}>
              <path d="M30 70 A76 76 0 0 1 120 26" stroke={`url(#${trail})`} strokeWidth="7" strokeLinecap="round" fill="none" />
              <circle cx="120" cy="26" r="5" fill="#d8f7ff" />
            </g>
          ))}
        </g>

        <g className="atom" filter={`url(#${glow})`} stroke="#5ad2f4" strokeWidth="2.2" fill="none">
          {[0, 60, 120].map((r) => (
            <ellipse key={r} cx="100" cy="100" rx="58" ry="18" transform={`rotate(${r} 100 100)`} />
          ))}
          <circle cx="158" cy="100" r="3" fill="#d8f7ff" stroke="none" />
          <circle cx="71" cy="49.8" r="3" fill="#d8f7ff" stroke="none" />
          <circle cx="71" cy="150.2" r="2.4" fill="#d8f7ff" stroke="none" />
        </g>

        <g className="core">
          <circle cx="100" cy="100" r="22" fill={`url(#${core})`} />
          <circle cx="100" cy="100" r="7" fill="#fff" />
        </g>
      </svg>
    </div>
  );
}
