// Materix app mark: a white "node-link M" — the letter M drawn as a
// connected network path — on a rounded indigo-gradient tile. Reads as a
// bold M down to 16px; the joined nodes give the matrix/network character
// up close. Self-contained inline SVG so it works on any background.

import { useId } from "react";

export function Logo({ size = 44 }: { size?: number }) {
  const gid = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="Materix"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gid} x1="8" y1="4" x2="40" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7C6BF5" />
          <stop offset="1" stopColor="#4B33CC" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="42" height="42" rx="11.5" fill={`url(#${gid})`} />
      <path
        d="M14 34 V14 L24 26 L34 14 V34"
        fill="none"
        stroke="#fff"
        strokeWidth="4.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g fill="#fff">
        <circle cx="14" cy="14" r="3.4" />
        <circle cx="24" cy="26" r="3.4" />
        <circle cx="34" cy="14" r="3.4" />
        <circle cx="14" cy="34" r="2.5" fillOpacity="0.85" />
        <circle cx="34" cy="34" r="2.5" fillOpacity="0.85" />
      </g>
    </svg>
  );
}
