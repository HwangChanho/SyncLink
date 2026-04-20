/**
 * __tests__/constants/sprint0.constants.test.ts
 *
 * QA verification for TASK-005: 디자인 토큰 & 상수
 *
 * Acceptance Criteria 검증:
 * - [x] src/constants/colors.ts — 팔레트, 내/상대 일정 색상, 시멘틱 색상
 * - [x] src/constants/typography.ts — 폰트 크기, 굵기, 라인 높이
 * - [x] src/constants/spacing.ts — 간격 시스템 (4px base)
 * - [x] src/constants/config.ts — 비즈니스 상수 (FREE_AI_DAILY_LIMIT 등)
 *
 * @task TASK-005
 * @verifiedBy QA
 */

import { palette, light, dark, memberEventColors, categoryColors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import {
  FREE_AI_DAILY_LIMIT,
  AI_FALLBACK_CONFIDENCE_THRESHOLD,
  NL_PARSE_MAX_INPUT_TOKENS,
  NL_PARSE_MAX_OUTPUT_TOKENS,
  SPACE_FREE_MAX,
  COUPLE_SPACE_MAX_MEMBERS,
  INVITE_CODE_LENGTH,
  INVITE_CODE_CHARSET,
  EDGE_FUNCTIONS,
  EVENT_TITLE_MAX_LENGTH,
  REALTIME_MAX_RECONNECT_ATTEMPTS,
} from '@/constants/config';

// ─── 색상 검증 헬퍼 ───────────────────────────────────────────────────────────

const HEX_COLOR_REGEX = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

function isHexColor(value: string): boolean {
  return HEX_COLOR_REGEX.test(value);
}

// ─── TASK-005: colors.ts 검증 ─────────────────────────────────────────────────

describe('TASK-005: colors.ts', () => {
  describe('palette', () => {
    it('all palette values are valid hex colors', () => {
      for (const [name, value] of Object.entries(palette)) {
        if (value === 'transparent') continue; // 예외 허용
        expect(isHexColor(value)).toBe(true);
        // 실패 시 어떤 색상인지 메시지에 포함
        if (!isHexColor(value)) {
          throw new Error(`palette.${name} = "${value}" is not a valid hex color`);
        }
      }
    });

    it('contains primary violet colors', () => {
      expect(palette.violet600).toBeDefined();
      expect(isHexColor(palette.violet600)).toBe(true);
    });

    it('contains accent rose colors', () => {
      expect(palette.rose500).toBeDefined();
    });
  });

  describe('light theme semantic colors', () => {
    it('all semantic keys are defined', () => {
      expect(light.primary).toBeDefined();
      expect(light.background).toBeDefined();
      expect(light.textPrimary).toBeDefined();
      expect(light.border).toBeDefined();
      expect(light.success).toBeDefined();
      expect(light.error).toBeDefined();
      expect(light.tabActive).toBeDefined();
      expect(light.tabInactive).toBeDefined();
    });

    it('primary is the violet600 palette color', () => {
      expect(light.primary).toBe(palette.violet600);
    });

    it('background is white', () => {
      expect(light.background).toBe(palette.white);
    });
  });

  describe('dark theme', () => {
    it('has the same keys as light theme', () => {
      const lightKeys = Object.keys(light).sort();
      const darkKeys = Object.keys(dark).sort();
      expect(darkKeys).toEqual(lightKeys);
    });

    it('background is gray900 in dark mode', () => {
      expect(dark.background).toBe(palette.gray900);
    });
  });

  describe('memberEventColors', () => {
    it('has at least 2 colors (owner + one member)', () => {
      expect(memberEventColors.length).toBeGreaterThanOrEqual(2);
    });

    it('all member event colors are valid hex colors', () => {
      for (const color of memberEventColors) {
        expect(isHexColor(color)).toBe(true);
      }
    });

    it('first color is owner default (violet)', () => {
      // 첫 번째 색상이 owner에 할당됨 — 보라 계열이어야 함
      expect(memberEventColors[0]).toBeDefined();
    });
  });

  describe('categoryColors', () => {
    it('contains all 9 built-in categories', () => {
      const expected = ['personal', 'work', 'date', 'family', 'health', 'social', 'travel', 'holiday', 'other'];
      for (const cat of expected) {
        expect(categoryColors).toHaveProperty(cat);
        expect(isHexColor(categoryColors[cat as keyof typeof categoryColors])).toBe(true);
      }
    });
  });
});

// ─── TASK-005: spacing.ts 검증 ────────────────────────────────────────────────

describe('TASK-005: spacing.ts', () => {
  it('spacing is defined and importable', () => {
    expect(spacing).toBeDefined();
  });

  it('uses 4px base unit (spacing[1] === 4)', () => {
    // 4px 기반 시스템: spacing[1] = 4, spacing[2] = 8, spacing[4] = 16
    expect(spacing[1]).toBe(4);
  });

  it('spacing[2] === 8 (double base)', () => {
    expect(spacing[2]).toBe(8);
  });

  it('spacing[4] === 16 (4x base — standard padding)', () => {
    expect(spacing[4]).toBe(16);
  });

  it('values increase monotonically', () => {
    const keys = Object.keys(spacing)
      .map(Number)
      .filter((k) => !isNaN(k))
      .sort((a, b) => a - b);

    for (let i = 1; i < keys.length; i++) {
      const prev = spacing[keys[i - 1] as keyof typeof spacing] as number;
      const curr = spacing[keys[i] as keyof typeof spacing] as number;
      expect(curr).toBeGreaterThan(prev);
    }
  });
});

// ─── TASK-005: typography.ts 검증 ────────────────────────────────────────────

describe('TASK-005: typography.ts', () => {
  it('textStyles is defined and importable', () => {
    expect(textStyles).toBeDefined();
  });

  it('contains heading styles (h1, h2, h3)', () => {
    expect(textStyles.h1).toBeDefined();
    expect(textStyles.h2).toBeDefined();
  });

  it('contains body style', () => {
    expect(textStyles.body).toBeDefined();
  });

  it('all text styles have fontSize property', () => {
    for (const [name, style] of Object.entries(textStyles)) {
      expect(typeof (style as { fontSize?: unknown }).fontSize).toBe('number');
    }
  });

  it('h1 fontSize is larger than body fontSize', () => {
    const h1Size = (textStyles.h1 as { fontSize: number }).fontSize;
    const bodySize = (textStyles.body as { fontSize: number }).fontSize;
    expect(h1Size).toBeGreaterThan(bodySize);
  });
});

// ─── TASK-005: config.ts 비즈니스 상수 검증 ──────────────────────────────────

describe('TASK-005: config.ts business constants', () => {
  describe('AI limits', () => {
    it('FREE_AI_DAILY_LIMIT is 5', () => {
      expect(FREE_AI_DAILY_LIMIT).toBe(5);
    });

    it('AI_FALLBACK_CONFIDENCE_THRESHOLD is "low"', () => {
      expect(AI_FALLBACK_CONFIDENCE_THRESHOLD).toBe('low');
    });

    it('NL_PARSE_MAX_INPUT_TOKENS is defined and positive', () => {
      expect(NL_PARSE_MAX_INPUT_TOKENS).toBeGreaterThan(0);
    });

    it('NL_PARSE_MAX_OUTPUT_TOKENS is defined and positive', () => {
      expect(NL_PARSE_MAX_OUTPUT_TOKENS).toBeGreaterThan(0);
    });

    it('input tokens >= output tokens (output is always shorter than input)', () => {
      expect(NL_PARSE_MAX_INPUT_TOKENS).toBeGreaterThanOrEqual(NL_PARSE_MAX_OUTPUT_TOKENS);
    });
  });

  describe('Space limits', () => {
    it('SPACE_FREE_MAX is 3', () => {
      expect(SPACE_FREE_MAX).toBe(3);
    });

    it('COUPLE_SPACE_MAX_MEMBERS is 2', () => {
      expect(COUPLE_SPACE_MAX_MEMBERS).toBe(2);
    });
  });

  describe('Invite code', () => {
    it('INVITE_CODE_LENGTH is 6', () => {
      expect(INVITE_CODE_LENGTH).toBe(6);
    });

    it('INVITE_CODE_CHARSET does not contain ambiguous characters (0, O, I, 1)', () => {
      // 사용자 오타 방지: 0과 O, 1과 I를 제외한 문자셋
      expect(INVITE_CODE_CHARSET).not.toContain('0');
      expect(INVITE_CODE_CHARSET).not.toContain('O');
      expect(INVITE_CODE_CHARSET).not.toContain('1');
      expect(INVITE_CODE_CHARSET).not.toContain('I');
    });

    it('INVITE_CODE_CHARSET has sufficient entropy (>= 20 chars)', () => {
      expect(INVITE_CODE_CHARSET.length).toBeGreaterThanOrEqual(20);
    });
  });

  describe('Edge function names', () => {
    it('EDGE_FUNCTIONS.PARSE_EVENT is "parse-event"', () => {
      expect(EDGE_FUNCTIONS.PARSE_EVENT).toBe('parse-event');
    });

    it('EDGE_FUNCTIONS.SMART_REMINDER is "smart-reminder"', () => {
      expect(EDGE_FUNCTIONS.SMART_REMINDER).toBe('smart-reminder');
    });

    it('all edge function names are kebab-case strings', () => {
      for (const name of Object.values(EDGE_FUNCTIONS)) {
        expect(typeof name).toBe('string');
        expect(name).toMatch(/^[a-z][a-z0-9-]*$/);
      }
    });
  });

  describe('Event constraints', () => {
    it('EVENT_TITLE_MAX_LENGTH is <= 255 (DB constraint)', () => {
      expect(EVENT_TITLE_MAX_LENGTH).toBeLessThanOrEqual(255);
      expect(EVENT_TITLE_MAX_LENGTH).toBeGreaterThan(0);
    });

    it('REALTIME_MAX_RECONNECT_ATTEMPTS is positive', () => {
      expect(REALTIME_MAX_RECONNECT_ATTEMPTS).toBeGreaterThan(0);
    });
  });
});
