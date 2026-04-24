/**
 * Sprint 15 TASK-1520 — useNetworkStatus tests.
 *
 * The hook polls a HEAD request against Supabase at a 5s interval to detect
 * online/offline state. We mock global.fetch and advance fake timers to
 * verify each branch.
 */

jest.mock('@/lib/supabase', () => ({
  supabase: {},
  SUPABASE_URL:      'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
}));

import { renderHook, waitFor } from '@testing-library/react-native';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';

describe('useNetworkStatus', () => {
  /** Store the original fetch so we can restore after each test. */
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('resolves online=true on successful probe', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;

    const { result } = renderHook(() => useNetworkStatus());

    await waitFor(() => expect(result.current.online).toBe(true));
  });

  it('resolves online=false when fetch rejects', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network request failed')) as unknown as typeof fetch;

    const { result } = renderHook(() => useNetworkStatus());

    await waitFor(() => expect(result.current.online).toBe(false));
  });

  it('starts with online=null before the first probe resolves', () => {
    // Hang the fetch to observe the initial null state.
    global.fetch = jest.fn(() => new Promise<never>(() => { /* never */ })) as unknown as typeof fetch;

    const { result } = renderHook(() => useNetworkStatus());

    expect(result.current.online).toBeNull();
  });
});
