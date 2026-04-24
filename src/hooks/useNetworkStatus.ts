/**
 * useNetworkStatus — live online/offline signal backed by `expo-network`.
 *
 * `Network.getNetworkStateAsync()` queries the OS link-state cache, which
 * reacts within a few hundred ms of airplane-mode changes and doesn't
 * spend any bytes. We poll it every 5 s to stay in sync without relying
 * on private APIs for push-style change events.
 *
 * A single in-flight probe is enforced via a ref so rapid re-renders
 * cannot spawn concurrent reads.
 *
 * Sprint 15 TASK-1520.
 */

import { useEffect, useRef, useState } from 'react';
import * as Network from 'expo-network';

/** How often (ms) to sample connectivity when the app is foregrounded. */
const POLL_INTERVAL_MS = 5000;

export interface UseNetworkStatusResult {
  /**
   * true  = device has a reachable internet link (wifi/cell).
   * false = link is down or airplane mode.
   * null  = we haven't sampled yet (first few ms after mount).
   */
  online: boolean | null;
}

async function probeOnline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    // `isConnected` tells us the interface is up; `isInternetReachable` is the
    // OS's opinion on whether the interface can actually talk to the Internet.
    // Some iOS builds leave `isInternetReachable` undefined — treat undefined
    // as optimistic (online) so we don't false-positive offline.
    if (state.isConnected === false) return false;
    if (state.isInternetReachable === false) return false;
    return true;
  } catch {
    // expo-network reading should never throw on supported platforms, but if
    // it does we fall back to "online" so the banner doesn't flash in dev.
    return true;
  }
}

/**
 * Subscribes the caller to live online/offline state.
 *
 * Safe to use at the application root (mounts a single interval). When the
 * hook unmounts, the interval is cleared.
 */
export function useNetworkStatus(): UseNetworkStatusResult {
  const [online, setOnline] = useState<boolean | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    const runProbe = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const ok = await probeOnline();
        if (mounted) setOnline(ok);
      } finally {
        inFlightRef.current = false;
      }
    };

    void runProbe();
    const id = setInterval(() => { void runProbe(); }, POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  return { online };
}
