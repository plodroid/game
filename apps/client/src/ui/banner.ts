import { BANNERS } from '@chromashift/shared';

const svg = (body: string, b: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 60'><g fill='${b}'>${body}</g></svg>`)}")`;

const SPLATS = "<path d='M30 14c4 0 5 6 8 7s7-5 10-2-2 7 0 10 8 1 8 5-6 4-6 7 5 7 3 9-7-1-9 1-1 8-5 9-5-5-9-5-6 6-9 4 0-7-3-9-8 1-9-3 5-5 4-9-6-5-4-8 7 0 8-3-3-8 1-10 7 3 9 1 2-8 6-8z'/><circle cx='92' cy='38' r='9'/><circle cx='104' cy='16' r='4'/><circle cx='70' cy='12' r='3'/><circle cx='80' cy='52' r='2.5'/>";
const DRIPS = "<rect width='120' height='14'/><rect x='10' y='10' width='7' height='30' rx='3.5'/><rect x='34' y='10' width='7' height='18' rx='3.5'/><rect x='58' y='10' width='7' height='40' rx='3.5'/><rect x='82' y='10' width='7' height='24' rx='3.5'/><rect x='104' y='10' width='7' height='34' rx='3.5'/>";

/** CSS background for a banner id. */
export function bannerCss(id: string): string {
  const { a, b, p } = BANNERS[id] ?? BANNERS.plain;
  switch (p) {
    case 'stripes':
      return `repeating-linear-gradient(0deg, ${a} 0 10px, ${b} 10px 20px)`;
    case 'diagonal':
      return `repeating-linear-gradient(45deg, ${a} 0 12px, ${b} 12px 24px)`;
    case 'dots':
      return `radial-gradient(${b} 28%, transparent 30%) 0 0 / 18px 18px, ${a}`;
    case 'check':
      return `conic-gradient(${b} 25%, ${a} 0 50%, ${b} 0 75%, ${a} 0) 0 0 / 24px 24px`;
    case 'grid':
      return `linear-gradient(${b} 2px, transparent 2px) 0 0 / 16px 16px, linear-gradient(90deg, ${b} 2px, transparent 2px) 0 0 / 16px 16px, ${a}`;
    case 'waves':
      return `radial-gradient(circle at 50% 120%, ${b} 40%, transparent 41%) 0 0 / 28px 16px, ${a}`;
    case 'splat':
      return `${svg(SPLATS, b)} center / cover no-repeat, ${a}`;
    case 'drip':
      return `${svg(DRIPS, b)} top / 100% auto no-repeat, ${a}`;
    default:
      return a;
  }
}
