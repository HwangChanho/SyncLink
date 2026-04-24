/**
 * useNetworkStatus — periodically samples network connectivity so the app
 * can show an offline banner and gate network-dependent actions.
 *
 * Implementation notes:
 *   - The CMD originally called for `expo-network` (`getNetworkStateAsync`)
 *     but that package could not be installed in this session due to an npm
 *     permission issue (see docs/escalations/CMD-019-expo-secure-store-install.md).
 *   - We therefore probe connectivity via a cheap HEAD request to the
 *     Supabase REST endpoint every 5 seconds. When `expo-network` becomes
 *     available, swap the internal `probeOnline()` function only — the
 *     hook's return shape does not change.
 *
 * The probe uses a short timeout so offline detection is fast and never
 * blocks the UI. A single in-flight probe is enforced via a ref so rapid
 * re-renders cannot spawn concurrent fetches.
 *
 * Sprint 15 TASK-1520.
 */

import { useEffect, useRef, useState } from 'react';
import { SUPABASE_URL } from '@/lib/supabase';

// ─── Config ───────────────────────────────────────────────────────────────────

/** How often (ms) to poll for network state when the app is in the foreground. */
const POLL_INTERVAL_MS = 5000;
/** Per-probe timeout. Short enough that offline detection is snappy. */
const PROBE_TIMEOUT_MS = 3000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UseNetworkStatusResult {
  /**
   * true  = last probe succeeded (internet reachable).
   * false = last probe failed (offline).
   * null  = we haven't probed yet (first few ms after mount).
   */
  online: boolean | null;
}

// ─── Internals ────────────────────────────────────────────────────────────────

/**
 * Perform a single reachability probe.
 * Resolves to `true` when the Supabase endpoint returns any HTTP response
 * (even a 4xx counts — the network is up).
 * Resolves to `false` if the fetch throws (DNS, connection, timeout).
 */
async function probeOnline(): Promise<boolean> {
  if (!SUPABASE_URL) {
    // Without a Supabase URL we can't do a meaningful probe — assume online
    // so the app isn't stuck behind a permanent offline banner in dev builds
    // that haven't been configured yet.
    return true;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/`, {
      method: 'HEAD',
      signal: controller.signal,
      // Supabase's PostgREST requires the apikey header but a missing one
      // just returns 401 — still proves the network is up, which is all we
      // care about here. We intentionally do not attach the key to avoid
      // leaking it in edge-case request logs.
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Subscribes the caller to live online/offline state.
 *
 * Safe to use at the application root (mounts a single interval). When the
 * hook unmounts, the interval is cleared and any in-flight probe is
 * abandoned.
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

    // Probe immediately on mount so the banner appears as soon as possible
    // when launching in airplane mode, then continue polling.
    void runProbe();
    const id = setInterval(() => { void runProbe(); }, POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  return { online };
}
