/**
 * useTranslatedTitles — batch, cache-only translation lookup for event titles
 * shown in list views (Month / Week / Day grids).
 *
 * Why a separate hook from useEventTranslation:
 *  - The list views render dozens of events at once. Calling the
 *    `translate-event` Edge Function per event would be costly (Claude API)
 *    and slow.
 *  - Sprint 19 TASK-1907 only promises translated titles when the user has
 *    *already* opened the event detail (which warmed the cache via
 *    useEventTranslation). So this hook is strictly read-only against
 *    `event_translations` — never an Edge Function call.
 *
 * Pro-only & target-locale gated:
 *  - Free users get an empty map (no DB hit).
 *  - When the UI locale isn't a translation locale, returns an empty map.
 *
 * Returns: Map<eventId, translatedTitle>. Consumers should fall back to the
 * original title when the map doesn't contain the id.
 *
 * Sprint 19 TASK-1907.
 */

import { useEffect, useState } from 'react';
import i18next from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { useSubscriptionStore } from '@/stores/subscriptionStore';

type TranslationLocale = 'ko' | 'en' | 'zh' | 'ja';
const SUPPORTED_LOCALES: readonly TranslationLocale[] = ['ko', 'en', 'zh', 'ja'];

function normaliseLocale(raw: string): TranslationLocale | null {
  const short = raw.slice(0, 2).toLowerCase();
  return (SUPPORTED_LOCALES as readonly string[]).includes(short)
    ? (short as TranslationLocale)
    : null;
}

/**
 * @param eventIds Stable list of event IDs currently rendered in the view.
 *                 Re-runs the lookup whenever the joined string changes, so
 *                 callers should pass a memoised array (or rely on the
 *                 join-string equality short-circuit below).
 */
export function useTranslatedTitles(eventIds: readonly string[]): Map<string, string> {
  const isPro = useSubscriptionStore((s) => s.plan === 'pro');

  // Subscribe to language changes the same way useEventTranslation does —
  // we don't go through useTranslation() because under Jest the singleton
  // instance occasionally desyncs.
  const [language, setLanguage] = useState<string>(i18next.language ?? 'en');
  useEffect(() => {
    const onChange = (lng: string) => setLanguage(lng);
    i18next.on('languageChanged', onChange);
    return () => { i18next.off('languageChanged', onChange); };
  }, []);

  const [titles, setTitles] = useState<Map<string, string>>(() => new Map());

  // Use the joined ID string as the dependency key so we re-run only when
  // the actual *set* of events changes, not on every parent re-render.
  const idKey = eventIds.join(',');

  useEffect(() => {
    if (!isPro) { setTitles(new Map()); return; }
    const targetLocale = normaliseLocale(language);
    if (!targetLocale) { setTitles(new Map()); return; }
    if (eventIds.length === 0) { setTitles(new Map()); return; }

    let cancelled = false;
    (async () => {
      try {
        // Cache-only batch SELECT. RLS limits results to events the user
        // can see; rows that exist mean the cache was warmed by an earlier
        // useEventTranslation call (event detail screen).
        const { data } = await supabase
          .from('event_translations')
          .select('event_id, translated_title, target_locale')
          .in('event_id', eventIds as string[])
          .eq('target_locale', targetLocale);
        if (cancelled) return;

        const rows = (data ?? []) as { event_id: string; translated_title: string }[];
        const next = new Map<string, string>();
        for (const r of rows) {
          if (r.event_id && r.translated_title) next.set(r.event_id, r.translated_title);
        }
        setTitles(next);
      } catch {
        // Translation is a polish-layer feature — never surface lookup
        // failures to the UI. Falling back to the original title is fine.
        if (!cancelled) setTitles(new Map());
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey, isPro, language]);

  return titles;
}
