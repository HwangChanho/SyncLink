/**
 * @task TASK-904 (Sprint 9) — AI Date Suggestion tests
 *
 * Tests for aiService.getDateSuggestion — calls the suggest-date Edge Function.
 * Supabase functions.invoke is mocked; no real network calls are made.
 */

import { supabase } from '@/lib/supabase';
import { getDateSuggestion } from '@/services/aiService';

jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
  getCurrentUserId: jest.fn().mockResolvedValue('user-123'),
}));

// nlParser is imported by aiService at module level but not called by
// getDateSuggestion — mock it to avoid any side effects.
jest.mock('@/lib/nlParser', () => ({
  parseLocally: jest.fn(),
}));

describe('aiService — getDateSuggestion', () => {
  const SPACE_ID   = 'space-abc';
  const WEEK_START = '2026-04-20';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('returns DateSuggestionResult on successful Edge Function call', async () => {
    const mockResult = {
      suggestion: '이번 주 토요일 오후에 한강 산책 어때요?',
      slots: [
        { start: '2026-04-25T14:00:00Z', end: '2026-04-25T16:00:00Z' },
      ],
    };

    (supabase.functions.invoke as jest.Mock).mockResolvedValue({
      data:  mockResult,
      error: null,
    });

    const result = await getDateSuggestion(SPACE_ID, WEEK_START);

    expect(result).toEqual(mockResult);
  });

  it('calls the suggest-date Edge Function with correct function name and body', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({
      data:  { suggestion: 'test', slots: [] },
      error: null,
    });

    await getDateSuggestion(SPACE_ID, WEEK_START);

    expect(supabase.functions.invoke).toHaveBeenCalledWith(
      'suggest-date',
      { body: { spaceId: SPACE_ID, weekStart: WEEK_START } },
    );
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(1);
  });

  it('returns result with multiple slots (max 3)', async () => {
    const mockResult = {
      suggestion: '주말에 세 가지 선택지가 있어요.',
      slots: [
        { start: '2026-04-25T10:00:00Z', end: '2026-04-25T12:00:00Z' },
        { start: '2026-04-25T14:00:00Z', end: '2026-04-25T16:00:00Z' },
        { start: '2026-04-26T09:00:00Z', end: '2026-04-26T11:00:00Z' },
      ],
    };

    (supabase.functions.invoke as jest.Mock).mockResolvedValue({
      data:  mockResult,
      error: null,
    });

    const result = await getDateSuggestion(SPACE_ID, WEEK_START);

    expect(result.slots).toHaveLength(3);
    expect(result.slots[0]).toEqual({
      start: '2026-04-25T10:00:00Z',
      end:   '2026-04-25T12:00:00Z',
    });
  });

  it('returns result with empty slots array when no free time found', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({
      data:  { suggestion: '이번 주는 공통 빈 시간이 없어요.', slots: [] },
      error: null,
    });

    const result = await getDateSuggestion(SPACE_ID, WEEK_START);

    expect(result.slots).toHaveLength(0);
    expect(result.suggestion).toBeTruthy();
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  it('throws with the error message when Edge Function returns an error', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({
      data:  null,
      error: { message: 'Edge Function timeout' },
    });

    await expect(getDateSuggestion(SPACE_ID, WEEK_START)).rejects.toThrow(
      'Edge Function timeout',
    );
  });

  it('throws with fallback message when error is present but has no message', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({
      data:  null,
      error: {},
    });

    await expect(getDateSuggestion(SPACE_ID, WEEK_START)).rejects.toThrow(
      'Date suggestion failed.',
    );
  });

  it('throws with fallback message when data is null and error is null', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({
      data:  null,
      error: null,
    });

    await expect(getDateSuggestion(SPACE_ID, WEEK_START)).rejects.toThrow(
      'Date suggestion failed.',
    );
  });
});
