import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = (size: number, p: P) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...p,
});

export const Icon = {
  back: ({ size = 20, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  ),
  play: ({ size = 20, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M8 5.5v13l10-6.5z" fill="currentColor" stroke="none" />
    </svg>
  ),
  globe: ({ size = 20, ...p }: P) => (
    <svg {...base(size, p)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.6 2.4 2.6 14.6 0 17M12 3.5c-2.6 2.4-2.6 14.6 0 17" />
    </svg>
  ),
  target: ({ size = 20, ...p }: P) => (
    <svg {...base(size, p)}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  ),
  users: ({ size = 20, ...p }: P) => (
    <svg {...base(size, p)}>
      <circle cx="9" cy="9" r="3.2" />
      <path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5" />
      <path d="M15.5 6.2a3 3 0 010 5.6M17 14.8c1.7.6 2.9 2 3.5 4.2" />
    </svg>
  ),
  key: ({ size = 20, ...p }: P) => (
    <svg {...base(size, p)}>
      <rect x="4" y="7" width="16" height="10" rx="2" />
      <path d="M8 12h.01M12 12h.01M16 12h.01" />
    </svg>
  ),
  bolt: ({ size = 20, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M13 3L5 13.5h6L10 21l8-10.5h-6z" />
    </svg>
  ),
  sliders: ({ size = 20, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M5 6h9M18 6h1M5 12h3M12 12h7M5 18h11M20 18h-1" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </svg>
  ),
  server: ({ size = 20, ...p }: P) => (
    <svg {...base(size, p)}>
      <rect x="4" y="4.5" width="16" height="6" rx="1.5" />
      <rect x="4" y="13.5" width="16" height="6" rx="1.5" />
      <path d="M7.5 7.5h.01M7.5 16.5h.01" />
    </svg>
  ),
  copy: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M5 15.5V6a1 1 0 011-1h9.5" />
    </svg>
  ),
  check: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  ),
  close: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
  crown: ({ size = 16, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M4 17l-1-9 5 4 4-6 4 6 5-4-1 9z" />
    </svg>
  ),
  bot: ({ size = 16, ...p }: P) => (
    <svg {...base(size, p)}>
      <rect x="5" y="8" width="14" height="10" rx="3" />
      <path d="M12 4v4M9.5 13h.01M14.5 13h.01" />
    </svg>
  ),
  swap: ({ size = 16, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M7 7h11l-3-3M17 17H6l3 3" />
    </svg>
  ),
  user: ({ size = 20, ...p }: P) => (
    <svg {...base(size, p)}>
      <circle cx="12" cy="8.5" r="3.8" />
      <path d="M4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" />
    </svg>
  ),
  google: ({ size = 18 }: P) => (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  ),
};

/** Team markers keep teams distinguishable without relying on colour alone. */
export function TeamShape({ team, size = 14 }: { team: number; size?: number }) {
  return team === 0 ? (
    <svg className="shape" width={size} height={size} viewBox="0 0 14 14" aria-label="Team A">
      <path d="M7 1.5L13 12.5H1z" fill="var(--team-a)" />
    </svg>
  ) : (
    <svg className="shape" width={size} height={size} viewBox="0 0 14 14" aria-label="Team B">
      <circle cx="7" cy="7" r="5.8" fill="var(--team-b)" />
    </svg>
  );
}

export function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <svg className="brand__mark" width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <path d="M20 3c7 6 13 10 13 18a13 13 0 01-26 0C7 13 13 9 20 3z" fill="var(--team-a)" />
      <path d="M20 13c3.8 3.2 7 5.6 7 9.8a7 7 0 01-14 0c0-4.2 3.2-6.6 7-9.8z" fill="var(--team-b)" />
    </svg>
  );
}
