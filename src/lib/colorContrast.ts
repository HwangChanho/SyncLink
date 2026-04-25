/**
 * colorContrast — pick a legible foreground (text/icon) colour for an
 * arbitrary background hex code.
 *
 * Implementation: standard W3C luminance formula (linearised sRGB →
 * weighted sum). A threshold of 0.5 sits roughly where the eye flips
 * preference between black-on-light and white-on-dark text.
 *
 * Used by the tab header (Sprint 19 — appearance feature) so the user can
 * tint the bar any colour and the title automatically stays readable.
 */

/**
 * Parse `#RRGGBB` (with or without leading #) into an [r, g, b] tuple in
 * the 0–255 range. Returns null on malformed input so callers can decide
 * how to fall back.
 */
function parseHex(hex: string): [number, number, number] | null {
  let s = hex.trim();
  if (s.startsWith('#')) s = s.slice(1);
  if (s.length !== 6) return null;
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return null;
  return [r, g, b];
}

/** Linearise a single sRGB channel (0–255 → 0–1). */
function linearise(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Return relative luminance of a background colour, 0 (black) → 1 (white).
 * Useful for comparison only — not a perceptual brightness number.
 */
export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map(linearise) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Pick `#000000` for light backgrounds and `#FFFFFF` for dark ones.
 *
 * The 0.5 cut-off favours legibility over brand exactness — fine-tuning
 * can be added later by exposing a third "auto-text" parameter, but for
 * the current header palette (all jewel-tones below 0.45 luminance) every
 * swatch correctly returns white text.
 */
export function contrastingTextColor(backgroundHex: string): string {
  return relativeLuminance(backgroundHex) > 0.5 ? '#000000' : '#FFFFFF';
}
