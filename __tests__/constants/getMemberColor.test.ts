/**
 * __tests__/constants/getMemberColor.test.ts
 *
 * Unit tests for `getMemberColor` — golden-angle hue rotation for Space members.
 *
 * Background:
 *   The previous `memberEventColors[i % 7]` approach collided once a Space
 *   reached 8 members. ADR-014 / IDEA-012 replaces that with a deterministic
 *   golden-angle (137.508°) rotation that scales to N without collisions.
 *
 * What we verify here:
 *   1. Hue is the expected `(index * 137.508) mod 360` for several indices.
 *   2. Dark-mode flag swaps lightness from 50% → 60%.
 *   3. Same `memberIndex` is deterministic — never returns a different colour
 *      across calls (critical because the value is persisted to DB).
 *
 * @task   IDEA-012 / ADR-014 (Sprint 27 R2)
 * @author DEV
 */

import { getMemberColor } from '@/constants/colors';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse `"hsl(H, S%, L%)"` into its three numeric components.
 * Returns null when the input is not in the expected format.
 *
 * Used by the assertion helpers below — keeps each test focused on one
 * dimension (hue, saturation, lightness) instead of doing string compare.
 */
function parseHsl(value: string): { h: number; s: number; l: number } | null {
  // Tolerate floats: e.g. "hsl(137.508, 65%, 50%)"
  const match = /^hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/.exec(value);
  if (!match) return null;
  return {
    h: parseFloat(match[1]!),
    s: parseFloat(match[2]!),
    l: parseFloat(match[3]!),
  };
}

const GOLDEN_ANGLE = 137.508;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('getMemberColor (ADR-014 — golden-angle hue rotation)', () => {
  describe('hue calculation', () => {
    it('member 0 maps to hue 0 (sequence start)', () => {
      const parsed = parseHsl(getMemberColor(0));
      expect(parsed).not.toBeNull();
      expect(parsed!.h).toBeCloseTo(0, 3);
    });

    it('member 1 maps to hue ≈137.508° (one golden angle)', () => {
      const parsed = parseHsl(getMemberColor(1));
      expect(parsed).not.toBeNull();
      expect(parsed!.h).toBeCloseTo(GOLDEN_ANGLE, 3);
    });

    it('member 5 maps to hue (5 × 137.508) mod 360', () => {
      // 5 * 137.508 = 687.54; mod 360 = 327.54
      const expected = (5 * GOLDEN_ANGLE) % 360;
      const parsed = parseHsl(getMemberColor(5));
      expect(parsed).not.toBeNull();
      expect(parsed!.h).toBeCloseTo(expected, 3);
    });

    it('member 100 wraps correctly via mod 360', () => {
      const expected = (100 * GOLDEN_ANGLE) % 360;
      const parsed = parseHsl(getMemberColor(100));
      expect(parsed).not.toBeNull();
      // Hue must always be within [0, 360) regardless of input magnitude.
      expect(parsed!.h).toBeGreaterThanOrEqual(0);
      expect(parsed!.h).toBeLessThan(360);
      expect(parsed!.h).toBeCloseTo(expected, 3);
    });
  });

  describe('lightness toggles with `dark` option', () => {
    it('defaults to 50% lightness (light theme)', () => {
      const parsed = parseHsl(getMemberColor(3));
      expect(parsed!.l).toBe(50);
    });

    it('returns 60% lightness when { dark: true }', () => {
      const parsed = parseHsl(getMemberColor(3, { dark: true }));
      expect(parsed!.l).toBe(60);
    });

    it('explicit { dark: false } matches the default', () => {
      const a = parseHsl(getMemberColor(7));
      const b = parseHsl(getMemberColor(7, { dark: false }));
      expect(a!.l).toBe(b!.l);
      expect(a!.h).toBeCloseTo(b!.h, 3);
    });

    it('saturation is 65% for both themes (locked by ADR-014)', () => {
      expect(parseHsl(getMemberColor(2))!.s).toBe(65);
      expect(parseHsl(getMemberColor(2, { dark: true }))!.s).toBe(65);
    });
  });

  describe('determinism (same input → same output)', () => {
    it('returns the byte-identical string on repeated calls', () => {
      // Persisted to space_members.color — repeat calls MUST agree.
      const first = getMemberColor(42);
      const second = getMemberColor(42);
      const third = getMemberColor(42);
      expect(first).toBe(second);
      expect(second).toBe(third);
    });

    it('different indices produce different colours (no collisions for 0..7)', () => {
      // Smoke check that the old % 7 collision is gone: the first 8 members
      // (indices 0..7, the case where the legacy palette wrapped) now all
      // have distinct hues.
      const colors = new Set<string>();
      for (let i = 0; i < 8; i++) {
        colors.add(getMemberColor(i));
      }
      expect(colors.size).toBe(8);
    });
  });

  describe('input hardening', () => {
    it('treats negative or non-finite input as index 0', () => {
      // Defensive: callers pass `memberList.length` which is always ≥ 0,
      // but be explicit about the contract.
      expect(getMemberColor(-1)).toBe(getMemberColor(0));
      expect(getMemberColor(NaN)).toBe(getMemberColor(0));
      expect(getMemberColor(Infinity)).toBe(getMemberColor(0));
    });

    it('floors fractional indices to keep the sequence integer-stepped', () => {
      expect(getMemberColor(2.9)).toBe(getMemberColor(2));
    });
  });
});
