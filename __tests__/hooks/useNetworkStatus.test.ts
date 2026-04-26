/**
 * Sprint 15 TASK-1520 — useNetworkStatus tests.
 *
 * The hook polls expo-network's getNetworkStateAsync at a 5s interval.
 * Updated to mock expo-network instead of global.fetch (Sprint 19 change).
 */

jest.mock('@/lib/supabase', () => ({
  supabase: {},
  SUPABASE_URL:      'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
}));

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(),
}));

import { renderHook, waitFor } from '@testing-library/react-native';
import * as Network from 'expo-network';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';

const mockGetNetworkState = Network.getNetworkStateAsync as jest.Mock;

describe('useNetworkStatus', () => {
  beforeEach(() => {
    mockGetNetworkState.mockReset();
  });

  it('resolves online=true on successful probe', async () => {
    mockGetNetworkState.mockResolvedValue({ isConnected: true, isInternetReachable: true });

    const { result } = renderHook(() => useNetworkStatus());

    await waitFor(() => expect(result.current.online).toBe(true));
  });

  it('resolves online=false when network is disconnected', async () => {
    mockGetNetworkState.mockResolvedValue({ isConnected: false, isInternetReachable: false });

    const { result } = renderHook(() => useNetworkStatus());

    await waitFor(() => expect(result.current.online).toBe(false));
  });

  it('resolves online=false when internet is not reachable', async () => {
    mockGetNetworkState.mockResolvedValue({ isConnected: true, isInternetReachable: false });

    const { result } = renderHook(() => useNetworkStatus());

    await waitFor(() => expect(result.current.online).toBe(false));
  });

  it('starts with online=null before the first probe resolves', () => {
    // Hang the probe to observe the initial null state.
    mockGetNetworkState.mockImplementation(() => new Promise<never>(() => { /* never */ }));

    const { result } = renderHook(() => useNetworkStatus());

    expect(result.current.online).toBeNull();
  });
});
