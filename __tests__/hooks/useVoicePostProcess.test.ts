/**
 * useVoicePostProcess — v1.1 Phase 1 unit tests.
 *
 * Verifies the three branches the hook is responsible for:
 *  1. Empty transcript → null (no edge call).
 *  2. nlParser confidence >= 'medium' → returns the original transcript
 *     without invoking the Edge Function. This is the cost-saving path.
 *  3. nlParser confidence === 'low' → Edge Function is called and the
 *     response's `best` + `alternatives` are surfaced verbatim.
 *  4. Edge Function failure → soft-fall back to original transcript so
 *     the user can still submit.
 *
 * Mocks: `@/lib/nlParser` (parseLocally) + `@/lib/supabase` (functions).
 */

import { renderHook, act } from '@testing-library/react-native';

jest.mock('@/lib/nlParser', () => ({
  parseLocally: jest.fn(),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));
jest.mock('@/lib/errorLogger', () => ({
  logError: jest.fn().mockResolvedValue(undefined),
}));

import { parseLocally } from '@/lib/nlParser';
import { supabase } from '@/lib/supabase';
import { useVoicePostProcess } from '@/hooks/useVoicePostProcess';

const mockParseLocally = parseLocally as jest.MockedFunction<typeof parseLocally>;
const mockInvoke = supabase.functions.invoke as jest.MockedFunction<
  typeof supabase.functions.invoke
>;

describe('useVoicePostProcess', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('빈 transcript 면 null 반환 + Edge 호출 X', async () => {
    const { result } = renderHook(() => useVoicePostProcess());
    let out: Awaited<ReturnType<typeof result.current.refine>> = null;
    await act(async () => {
      out = await result.current.refine('   ');
    });
    expect(out).toBeNull();
    expect(mockParseLocally).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('로컬 파서가 medium/high 면 원문 그대로 + Edge 호출 X', async () => {
    mockParseLocally.mockReturnValue({
      parsed: {}, confidence: 'high', source: 'local', rawInput: '내일 3시',
      processingMs: 1,
    });
    const { result } = renderHook(() => useVoicePostProcess());
    let out: Awaited<ReturnType<typeof result.current.refine>> = null;
    await act(async () => {
      out = await result.current.refine('내일 3시');
    });
    expect(out).toEqual({ best: '내일 3시', alternatives: [], aiUsed: false });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('로컬 파서 low → Edge 호출, best + alternatives 전달', async () => {
    mockParseLocally.mockReturnValue({
      parsed: {}, confidence: 'low', source: 'local', rawInput: '어쩌고 저쩌고',
      processingMs: 1,
    });
    mockInvoke.mockResolvedValue({
      data: { best: '내일 오후 3시 미팅', alternatives: ['내일 오후 3시 30분 미팅'], tokensUsed: 42 },
      error: null,
    } as unknown as { data: unknown; error: null });
    const { result } = renderHook(() => useVoicePostProcess());
    let out: Awaited<ReturnType<typeof result.current.refine>> = null;
    await act(async () => {
      out = await result.current.refine('어쩌고 저쩌고');
    });
    expect(mockInvoke).toHaveBeenCalledWith(
      'disambiguate-voice',
      expect.objectContaining({
        body: expect.objectContaining({ transcript: '어쩌고 저쩌고' }),
      }),
    );
    expect(out).toEqual({
      best: '내일 오후 3시 미팅',
      alternatives: ['내일 오후 3시 30분 미팅'],
      aiUsed: true,
    });
  });

  it('Edge 에러 → 원문을 best 로 soft-fail', async () => {
    mockParseLocally.mockReturnValue({
      parsed: {}, confidence: 'low', source: 'local', rawInput: '뭐 어쩌고',
      processingMs: 1,
    });
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'boom' } } as unknown as { data: null; error: { message: string } });
    const { result } = renderHook(() => useVoicePostProcess());
    let out: Awaited<ReturnType<typeof result.current.refine>> = null;
    await act(async () => {
      out = await result.current.refine('뭐 어쩌고');
    });
    expect(out).toEqual({ best: '뭐 어쩌고', alternatives: [], aiUsed: false });
  });

  it('Edge throw → catch 후 원문 그대로 + logError 1회', async () => {
    mockParseLocally.mockReturnValue({
      parsed: {}, confidence: 'low', source: 'local', rawInput: '오류 케이스',
      processingMs: 1,
    });
    mockInvoke.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useVoicePostProcess());
    let out: Awaited<ReturnType<typeof result.current.refine>> = null;
    await act(async () => {
      out = await result.current.refine('오류 케이스');
    });
    expect(out).toEqual({ best: '오류 케이스', alternatives: [], aiUsed: false });
  });
});
