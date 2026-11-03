import * as THREE from 'three';
import { useSettings } from '../settings/settings';

/** Team colour pairs. The colour-blind sets keep the two teams apart on luminance as well as hue. */
export const PALETTES = {
  off: [0xff3f8e, 0x19d3be],
  deuteranopia: [0xff9a1f, 0x2f6dff],
  protanopia: [0xffc21a, 0x3a5cff],
  tritanopia: [0xff4d6d, 0x10b383],
} as const;

export const TEAM_NAMES = ['Magenta', 'Teal'] as const;
export const TEAM_NAMES_CB: Record<keyof typeof PALETTES, [string, string]> = {
  off: ['Magenta', 'Teal'],
  deuteranopia: ['Orange', 'Blue'],
  protanopia: ['Amber', 'Blue'],
  tritanopia: ['Red', 'Green'],
};

export function teamColors(): [THREE.Color, THREE.Color] {
  const p = PALETTES[useSettings.getState().accessibility.colorblind];
  return [new THREE.Color(p[0]), new THREE.Color(p[1])];
}

export function teamNames(): [string, string] {
  return TEAM_NAMES_CB[useSettings.getState().accessibility.colorblind];
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** Mirrors the palette into CSS custom properties for the interface. */
export function syncPaletteCss() {
  const p = PALETTES[useSettings.getState().accessibility.colorblind];
  const s = document.documentElement.style;
  s.setProperty('--team-a', hex(p[0]));
  s.setProperty('--team-b', hex(p[1]));
}
