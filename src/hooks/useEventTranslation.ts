/**
 * useEventTranslation — fetches (or loads from cache) an AI translation of
 * an event's title & description for the current i18n locale.
 *
 * Pro-only behaviour:
 *  - Free users: hook is a no-op (`translated: null`, `loading: false`).
 *  - Same-locale: hook is a no-op.
 *  - Cache hit (event_translations row matching event_id + target_locale + hash):
 *    return cached values without calling the Edge Function.
 *  - Cache miss: invokes the `translate-event` Edge Function which writes to
 *    the cache and returns the translation.
 *
 * The source-locale heuristic uses cheap character-range regexes (same as the
 * Edge Function) so the free/Pro split can happen locally without a network
 * round-trip when the detected source locale already matches the UI locale.
 *
 * Sprint 15 TASK-1502.
 */

import { useEffect, useState } from 'react';
import i18next from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import type { Event } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Locales the translate-event Edge Function understands. */
type TranslationLocale = 'ko' | 'en' | 'zh' | 'ja';

const SUPPORTED_LOCALES: readonly TranslationLocale[] = ['ko', 'en', 'zh', 'ja'];

/** Result returned to the caller. */
export interface EventTranslationResult {
  /** Translated title+description, or null when not applicable / still loading. */
  translated: { title: string; description: string | null } | null;
  /** True while a network request is in-flight. */
  loading: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Detect the probable source locale for an event using the same heuristic as
 * the Edge Function — keeps client and server in lockstep so the "same
 * locale, skip" branch is consistent.
 *
 * @param event Event whose title & description are used as the detection corpus.
 */
function detectEventSourceLocale(event: Event): TranslationLocale {
  const text = `${event.title}\n${event.description ?? ''}`;
  if (/[가-힯]/.test(text)) return 'ko';
  if (/[぀-ゟ]|[゠-ヿ]/.test(text)) return 'ja';
  if (/[一-鿿]/.test(text)) return 'zh';
  return 'en';
}

/** Coerce `i18next.language` into a supported translation locale. */
function normaliseLocale(raw: string): TranslationLocale | null {
  const short = raw.slice(0, 2).toLowerCase();
  return (SUPPORTED_LOCALES as readonly string[]).includes(short)
    ? (short as TranslationLocale)
    : null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Returns an AI translation of the event when available and the caller is a
 * Pro subscriber whose UI locale differs from the event's source locale.
 *
 * The hook is safe to call on every render — all branches short-circuit when
 * the translation is unnecessary, so no network traffic is generated for free
 * users or same-locale events.
 *
 * @param event The event to translate. Pass `null` before the event is loaded
 *              to keep the hook a no-op.
 */
export function useEventTranslation(event: Event | null): EventTranslationResult {
  const isPro = useSubscriptionStore((s) => s.plan === 'pro');
  // Subscribe directly to the shared i18next singleton so we re-run the
  // effect whenever the user switches language. We deliberately avoid
  // `useTranslation()` here — Jest/jest-expo sometimes yields a second
  // i18next instance inside the hook, which caused stale-language reads in
  // tests. `i18next.language` is safe to read at module load time because
  // @/lib/i18n initialises it synchronously.
  const [language, setLanguage] = useState<string>(i18next.language ?? 'en');
  useEffect(() => {
    const onChange = (lng: string) => setLanguage(lng);
    i18next.on('languageChanged', onChange);
    return () => { i18next.off('languageChanged', onChange); };
  }, []);

  const [translated, setTranslated] = useState<EventTranslationResult['translated']>(null);
  const [loading,    setLoading]    = useState(false);

  useEffect(() => {
    // Reset state whenever the inputs change so the consumer UI never shows
    // a stale translation of a previous event/locale pair.
    setTranslated(null);
    setLoading(false);

    if (!event) return;
    if (!isPro) return;

    const targetLocale = normaliseLocale(language);
    if (!targetLocale) return;

    const sourceLocale = detectEventSourceLocale(event);
    if (sourceLocale === targetLocale) return;

    // Cancellation flag so we ignore late responses after unmount / rerun.
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        // 1) Cache-first SELECT. Uses the RLS-scoped client so viewers can
        //    only read translations of events they can see.
        //
        // Note: `event_translations` is not present in the generated Database
        // types yet; cast the query result to the narrow shape we actually
        // read. The columns selected are validated at migration time (014).
        const { data: cached } = await supabase
          .from('event_translations')
          .select('translated_title, translated_desc, target_locale')
          .eq('event_id', event.id)
          .eq('target_locale', targetLocale)
          .maybeSingle();

        if (cancelled) return;
        const cachedRow = cached as
          | { translated_title: string; translated_desc: string | null; target_locale: string }
          | null;
        if (cachedRow) {
          setTranslated({
            title:       cachedRow.translated_title,
            description: cachedRow.translated_desc,
          });
          return;
        }

        // 2) Cache miss → ask the Edge Function. The function itself will
        //    re-check the cache with the source_hash to handle concurrent
        //    writers; the client does not need to dedupe further.
        const { data, error } = await supabase.functions.invoke('translate-event', {
          body: { event_id: event.id, target_locale: targetLocale },
        });

        if (cancelled) return;
        if (error) throw error;
        if (!data || typeof data !== 'object') throw new Error('empty_response');

        // Narrow the response shape before surfacing to the UI. We never want
        // to crash the screen because of a malformed payload.
        const payload = data as {
          title?: string;
          description?: string | null;
        };
        if (typeof payload.title !== 'string') throw new Error('invalid_payload');

        setTranslated({
          title:       payload.title,
          description: payload.description ?? null,
        });
      } catch {
        // Swallow errors — the UI will simply show the original title/desc.
        // The Edge Function logs server-side failures to `error_logs`.
        if (!cancelled) setTranslated(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [event, isPro, language]);

  return { translated, loading };
}
