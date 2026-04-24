/**
 * __tests__/hooks/useEventTranslation.test.ts
 *
 * Sprint 15 TASK-1502 — useEventTranslation hook tests.
 *
 * Coverage:
 *  - Free plan: hook is a no-op (no network call, translated=null).
 *  - Pro plan + same locale: hook is a no-op.
 *  - Pro plan + different locale + cache hit: returns cached row without
 *    invoking the Edge Function.
 *  - Pro plan + different locale + cache miss: invokes translate-event and
 *    returns the payload.
 *  - Pro plan + different locale + Edge Function error: falls back to null.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Lightweight AsyncStorage mock (unused here but imported transitively).
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

/**
 * Supabase client mock.
 *
 * jest.mock factories are hoisted above `const` declarations, so outer
 * `jest.fn()` handles would still be `undefined` when the factory first runs.
 * We expose the handles via `(globalThis as any).__MOCK_HANDLES__` which the
 * factory populates at evaluation time. Tests read them after imports have
 * resolved, which is always *after* the factory has executed.
 */
jest.mock('@/lib/supabase', () => {
  const maybeSingle = jest.fn();
  const invoke      = jest.fn();
  const builder: Record<string, jest.Mock> = {
    select:      jest.fn(() => builder),
    eq:          jest.fn(() => builder),
    maybeSingle,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).__MOCK_HANDLES__ = { maybeSingle, invoke };
  return {
    supabase: {
      from:      jest.fn(() => builder),
      functions: { invoke },
    },
  };
});

// Import `supabase` so the jest.mock factory above is evaluated and the
// handles are published onto globalThis before any test runs.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { supabase as __forceMockInit } from '@/lib/supabase';

// Resolved once the factory has executed (immediately after the import above).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const __mockHandles = (globalThis as any).__MOCK_HANDLES__ as {
  maybeSingle: jest.Mock;
  invoke:      jest.Mock;
};
const mockMaybeSingle = __mockHandles.maybeSingle;
const mockInvoke      = __mockHandles.invoke;

// ─── Imports ──────────────────────────────────────────────────────────────────

// IMPORTANT: import the i18n module BEFORE the hook so the shared i18next
// singleton is registered with react-i18next — otherwise useTranslation()
// falls back to its own pristine instance and doesn't observe our
// `changeLanguage` calls from this test file.
import i18next from '@/lib/i18n';
import { renderHook, waitFor } from '@testing-library/react-native';
import { useEventTranslation } from '@/hooks/useEventTranslation';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import type { Event } from '@/types';

// ─── Fixture ──────────────────────────────────────────────────────────────────

/**
 * Build a Korean-source event fixture. Only fields consumed by the hook
 * matter; the rest are dummy values that satisfy the Event interface.
 */
function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id:             'evt-1',
    userId:         'user-1',
    title:          '저녁 약속',
    description:    '강남에서 만나요',
    location:       null,
    startAt:        new Date('2026-05-01T18:00:00Z'),
    endAt:          new Date('2026-05-01T20:00:00Z'),
    allDay:         false,
    repeatType:     'none',
    repeatUntil:    null,
    categoryId:     null,
    color:          null,
    sharedSpaceIds: [],
    ownerNickname:  'daniel',
    isOwn:          true,
    createdAt:      new Date(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useEventTranslation', () => {
  beforeEach(async () => {
    // NOTE: we deliberately avoid jest.clearAllMocks() here — it also wipes
    // the chainable `jest.fn(() => builder)` implementations in some jest
    // versions, breaking the Supabase fluent query API mock. We reset the
    // specific mocks we rely on for per-test setup instead.
    mockMaybeSingle.mockReset();
    mockInvoke.mockReset();
    // Default store state: free user, UI locale = en. Awaiting keeps the
    // language switch deterministic — a fire-and-forget changeLanguage() call
    // from the previous test could otherwise still be in-flight.
    useSubscriptionStore.setState({ plan: 'free' });
    await i18next.changeLanguage('en');
  });

  it('is a no-op for free users (never calls cache or edge fn)', async () => {
    const event = makeEvent();

    const { result } = renderHook(() => useEventTranslation(event));

    // Microtask flush: the effect is synchronous but we give it a tick.
    await new Promise((r) => setTimeout(r, 0));

    expect(result.current.translated).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(mockMaybeSingle).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('is a no-op when UI locale matches event source locale', async () => {
    useSubscriptionStore.setState({ plan: 'pro' });
    await i18next.changeLanguage('ko'); // event is Korean → same locale

    const event = makeEvent();
    const { result } = renderHook(() => useEventTranslation(event));

    await new Promise((r) => setTimeout(r, 0));

    expect(result.current.translated).toBeNull();
    expect(mockMaybeSingle).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('returns cached translation without calling the edge function', async () => {
    useSubscriptionStore.setState({ plan: 'pro' });
    await i18next.changeLanguage('en');
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        translated_title: 'Dinner plans',
        translated_desc:  'Meet in Gangnam',
        target_locale:    'en',
      },
      error: null,
    });

    const event = makeEvent();
    const { result } = renderHook(() => useEventTranslation(event));

    await waitFor(() => {
      expect(result.current.translated).toEqual({
        title:       'Dinner plans',
        description: 'Meet in Gangnam',
      });
    });
    expect(result.current.loading).toBe(false);
    expect(mockInvoke).not.toHaveBeenCalled();
    // Sanity: confirm the chain resolved correctly.
    expect(mockMaybeSingle).toHaveBeenCalled();
  });

  it('falls through to the edge function on cache miss and returns its payload', async () => {
    useSubscriptionStore.setState({ plan: 'pro' });
    await i18next.changeLanguage('en');
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockInvoke.mockResolvedValueOnce({
      data: {
        title:         'Dinner plans',
        description:   'Meet in Gangnam',
        cached:        false,
        source_locale: 'ko',
        target_locale: 'en',
      },
      error: null,
    });

    const event = makeEvent();
    const { result } = renderHook(() => useEventTranslation(event));

    await waitFor(() => {
      expect(result.current.translated).toEqual({
        title:       'Dinner plans',
        description: 'Meet in Gangnam',
      });
    });
    expect(mockInvoke).toHaveBeenCalledWith('translate-event', {
      body: { event_id: 'evt-1', target_locale: 'en' },
    });
  });

  it('falls back to null when the edge function returns an error', async () => {
    useSubscriptionStore.setState({ plan: 'pro' });
    await i18next.changeLanguage('en');
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockInvoke.mockResolvedValueOnce({ data: null, error: new Error('boom') });

    const event = makeEvent();
    const { result } = renderHook(() => useEventTranslation(event));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.translated).toBeNull();
  });

  it('is a no-op when event is null', async () => {
    useSubscriptionStore.setState({ plan: 'pro' });
    await i18next.changeLanguage('en');

    const { result } = renderHook(() => useEventTranslation(null));

    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.translated).toBeNull();
    expect(mockMaybeSingle).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
