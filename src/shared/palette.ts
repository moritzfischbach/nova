/** Luminous tones that read well on Nova's near-black surfaces (dark text on top). */
export const PALETTE = {
  champagne: '#D8C39A',
  silver: '#C5CBD3',
  sky: '#9DB9D6',
  sage: '#9CC5AD',
  moss: '#B5C48E',
  amber: '#E3B57E',
  rose: '#E3A39B',
  orchid: '#D9A6C6',
  lavender: '#B7A9DA',
  stone: '#A8A39B',
} as const;

/** Colors from the earlier light theme → their dark-theme counterpart (stored data keeps working). */
const LEGACY: Record<string, string> = {
  '#4A2458': PALETTE.lavender,
  '#7C4A6A': PALETTE.orchid,
  '#3D7A9A': PALETTE.sky,
  '#2E8B6A': PALETTE.sage,
  '#5B8A4A': PALETTE.moss,
  '#D08A2A': PALETTE.amber,
  '#C45C5C': PALETTE.rose,
  '#B85C8A': '#E0A6C0',
  '#C9A36A': PALETTE.champagne,
  '#6B5B95': PALETTE.lavender,
  '#8B5E83': '#C9A9C9',
  '#C96B8C': '#E6A8B8',
  '#3D7A5A': PALETTE.sage,
  '#8A7E76': PALETTE.stone,
};

export function displayColor(color: string | undefined, fallback: string = PALETTE.silver): string {
  if (!color) return fallback;
  return LEGACY[color.toUpperCase()] ?? color;
}
