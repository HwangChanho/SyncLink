/**
 * useVoicePostProcess — v1.1 Phase 1
 *
 * Bridges the raw STT transcript from useSpeechRecognition into a cleaned
 * sentence the local nlParser is more likely to score 'medium'/'high'.
 *
 * Flow:
 *   transcript ──► local nlParser  ──► confidence high/medium? ──► done
 *                                  └── confidence low ──► AI disambiguate
 *                                                          ├── single best   → swap text
 *                                                          └── 2 candidates  → expose chips
 *
 * Selective: we only call the Edge Function when the *local* parser is
 * uncertain, mirroring the cost-saving rule already in aiService.ts.
 *
 * Design notes:
 *   - Stateless apart from in-flight flag — the caller drives `text` /
 *     `setText` so the hook can be dropped into any input.
 *   - No caching. STT transcripts rarely repeat verbatim, and short Haiku
 *     calls (≤80 tokens out) are cheap.
 *   - Failure modes return `null` so the caller silently falls back to
 *     the original transcript without an alert (UX preference).
 */

import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { EDGE_FUNCTIONS } from '@/constants/config';
import { parseLocally } from '@/lib/nlParser';
import { logError } from '@/lib/errorLogger';

export interface VoicePostProcessResult {
  /** AI's best single guess. Same as input transcript when nothing to fix. */
  best: string;
  /** 0–2 alternative interpretations for chip choice UI. */
  alternatives: string[];
  /** True when we actually invoked the Edge Function (i.e. local parser
   *  scored 'low' on the original transcript). Callers use this to decide
   *  whether to show a "AI 보정됨" badge. */
  aiUsed: boolean;
}

export interface UseVoicePostProcessApi {
  /** True while an Edge Function call is in flight. */
  busy: boolean;
  /** Run the pipeline. Returns null on auth / network failure. */
  refine: (transcript: string, locale?: string) => Promise<VoicePostProcessResult | null>;
}

interface EdgeResponse {
  best: string;
  alternatives: string[];
  tokensUsed: number;
}

export function useVoicePostProcess(): UseVoicePostProcessApi {
  const [busy, setBusy] = useState(false);

  const refine = useCallback(
    async (transcript: string, locale?: string): Promise<VoicePostProcessResult | null> => {
      const trimmed = transcript.trim();
      if (!trimmed) return null;

      // 1) Run the local parser. If it's already confident, skip the AI call.
      const localResult = parseLocally(trimmed);
      if (localResult.confidence !== 'low') {
        return { best: trimmed, alternatives: [], aiUsed: false };
      }

      // 2) Call the Edge Function. supabase.functions.invoke handles JWT
      //    + serialisation for us.
      setBusy(true);
      try {
        const { data, error } = await supabase.functions.invoke<EdgeResponse>(
          EDGE_FUNCTIONS.DISAMBIGUATE_VOICE,
          {
            body: {
              transcript: trimmed,
              locale: locale ?? 'ko',
            },
          },
        );

        if (error || !data) {
          // Soft-fail: return original so the user can still submit.
          return { best: trimmed, alternatives: [], aiUsed: false };
        }

        const best = data.best?.trim() || trimmed;
        const alternatives = Array.isArray(data.alternatives)
          ? data.alternatives.filter((s) => typeof s === 'string' && s.trim()).slice(0, 2)
          : [];
        return { best, alternatives, aiUsed: true };
      } catch (err) {
        logError({ context: 'useVoicePostProcess.refine', error: err }).catch(() => { /* noop */ });
        return { best: trimmed, alternatives: [], aiUsed: false };
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return { busy, refine };
}
