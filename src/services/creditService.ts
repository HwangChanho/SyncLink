/**
 * creditService — Read/write the user's ad-earned AI credits.
 *
 * The credit column (`users.ai_ad_credits`) is incremented server-side by the
 * `reward-credit` Edge Function after AdMob SSV verification. The client is
 * only allowed to DECREMENT (consume) a credit, and to READ its own balance.
 *
 * We go through a service layer (never supabase.from() from a component) so
 * that the adapter boundary is respected (CLAUDE.md absolute rule) and we can
 * swap the storage backend without touching UI code.
 *
 * Sprint 14 TASK-1403
 */

import { supabase, getCurrentUserId } from '@/lib/supabase';

// supabase-js Database typing is incomplete for Relationships, so we cast
// locally — matches the pattern used in categoryService.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supa = supabase as any;

/**
 * Fetch the current user's ad-earned credit balance. Returns 0 when no user
 * row exists yet (first login) or on transient errors so that callers can
 * treat the balance as definitive — additional errors should not block AI
 * features beyond the normal quota logic.
 */
export async function fetchAdCreditBalance(): Promise<number> {
  const userId = await getCurrentUserId();
  if (!userId) return 0;

  const { data, error } = await supa
    .from('users')
    .select('ai_ad_credits')
    .eq('id', userId)
    .single() as { data: { ai_ad_credits: number } | null; error: Error | null };

  if (error || !data) return 0;
  return data.ai_ad_credits ?? 0;
}

/**
 * Decrement the balance by 1. Returns the new balance after decrement, or
 * null if the user has no credits to spend. Relies on a conditional update so
 * that concurrent consumers cannot take the balance negative.
 */
export async function consumeAdCreditRemote(): Promise<number | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  // Fetch current balance first — we need it to compute the decrement value
  // because Supabase's JS client lacks a first-class atomic decrement.
  const current = await fetchAdCreditBalance();
  if (current <= 0) return null;

  const next = current - 1;

  const { error } = await supa
    .from('users')
    .update({ ai_ad_credits: next })
    .eq('id', userId)
    .gt('ai_ad_credits', 0) as { error: Error | null };

  if (error) return null;
  return next;
}
