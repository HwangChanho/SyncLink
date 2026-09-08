/**
 * nlRequestStore — 자연어 입력바(NLInputBar)의 **요청 상태와 초안**을 화면 밖에 둔다.
 *
 * ## 왜 store 로 올렸나 (2026-09-08 LEAD 지시)
 * 종전에는 입력 텍스트·첨부 사진·요청 진행 상태가 전부 NLInputBar 의 로컬 state
 * 였다. 그래서 사용자가 요청 중에 화면을 벗어나면 아래처럼 깨졌다:
 *
 *  | 상황 | 종전 | 지금 |
 *  |---|---|---|
 *  | 다른 탭 이동(홈↔캘린더) | 컴포넌트가 언마운트되며 **요청 결과가 갈 곳을 잃음** | store 가 받아 두었다가 돌아오면 보여준다 |
 *  | 다른 기능 진입(일정 생성 등) | 같음 | 같음 |
 *  | 백그라운드 이동 | iOS 가 fetch 를 끊고 **입력이 그대로 날아감** | 실패해도 초안이 남아 그대로 다시 보낸다 |
 *  | 앱 강제종료 | 텍스트·사진 전부 소실 | 초안을 복구한다(아래 영속화) |
 *
 * 🔑 요청 실행 자체를 store action 으로 옮긴 것이 핵심이다. 컴포넌트 안에서
 *    `await` 하면 그 컴포넌트가 사라질 때 결과를 받을 주체가 없어진다.
 *
 * ## 영속화 범위 (의도적으로 좁다)
 * - **텍스트는 항상 저장한다** — 가볍고, 사용자가 공들여 쓴 것이다.
 * - **사진은 uri 만 저장한다.** base64 는 장당 수백 KB~수 MB 라 AsyncStorage 에
 *   넣으면 앱이 느려지고 용량도 위험하다. 복구 시 uri 로 파일을 다시 읽고,
 *   읽히지 않으면(캐시 정리 등) 그 장만 조용히 버린다.
 * - **진행 중 요청은 저장하지 않는다.** 프로세스가 죽으면 그 HTTP 요청도 죽는다.
 *   재시작 후에는 초안만 복구해 사용자가 다시 보내게 한다 — 서버에 갔는지
 *   알 수 없는 요청을 자동 재전송하면 일정이 두 번 등록될 수 있다.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import {
  parseNaturalLanguageWithImages,
  parseNaturalLanguageMulti,
  type AiImageAttachment,
} from '@/services/aiService';
import { logError } from '@/lib/errorLogger';
import type { NLParseResult } from '@/types';

/** AsyncStorage 키 — 초안(텍스트 + 사진 uri) JSON. */
export const NL_DRAFT_STORAGE_KEY = '@synclink/nl_draft_v1';

/** 첨부 사진 한 장. `uri` 는 미리보기·복구용, `base64` 는 전송용. */
export interface NLAttachedImage {
  uri: string;
  base64: string;
  mediaType: AiImageAttachment['mediaType'];
}

/** 입력바가 그리는 상태. */
export type NLRequestState = 'idle' | 'loading' | 'done' | 'error';

/** 영속화되는 부분 — base64 는 일부러 뺐다(용량). */
interface PersistedDraft {
  text: string;
  imageUris: string[];
}

interface NLRequestStore {
  // ── 초안 ────────────────────────────────────────────────────────────────
  text: string;
  images: NLAttachedImage[];
  setText: (t: string) => void;
  setImages: (updater: (prev: NLAttachedImage[]) => NLAttachedImage[]) => void;
  clearDraft: () => void;

  // ── 요청 ────────────────────────────────────────────────────────────────
  state: NLRequestState;
  /** 완료된 파싱 결과. 화면이 돌아오면 이걸 보고 미리보기를 띄운다. */
  results: NLParseResult[] | null;
  /** 사용자에게 보여줄 실패 사유. */
  errorMessage: string;
  /** 요청이 도는 동안 앱이 백그라운드로 갔는지 — 실패 사유를 정확히 쓰기 위한 것. */
  backgrounded: boolean;
  markBackgrounded: () => void;

  /**
   * 요청을 실행한다. **컴포넌트가 사라져도 끝까지 진행되고 결과가 store 에 남는다.**
   *
   * @returns 완료된 결과(호출부가 바로 쓰고 싶을 때). 실패면 null.
   */
  submit: () => Promise<NLParseResult[] | null>;
  /** 결과를 소비한 뒤 호출 — 미리보기를 다시 띄우지 않게 한다. */
  consumeResults: () => void;
  /** 에러 표시를 지운다. */
  clearError: () => void;

  // ── 영속화 ──────────────────────────────────────────────────────────────
  hydrated: boolean;
  /** 저장된 초안을 읽어 복구한다(앱 시작 시 1회). */
  hydrate: () => Promise<void>;
}

/** 초안을 저장한다(fire-and-forget — 실패해도 입력을 막지 않는다). */
function persistDraft(text: string, images: NLAttachedImage[]): void {
  const payload: PersistedDraft = { text, imageUris: images.map((i) => i.uri) };
  // 둘 다 비면 키를 지운다 — 빈 초안을 남겨 두면 다음 실행에 헛일을 한다.
  const write = (!text.trim() && images.length === 0)
    ? AsyncStorage.removeItem(NL_DRAFT_STORAGE_KEY)
    : AsyncStorage.setItem(NL_DRAFT_STORAGE_KEY, JSON.stringify(payload));
  void write.catch(() => { /* 저장 실패는 조용히 넘긴다 */ });
}

export const useNLRequestStore = create<NLRequestStore>((set, get) => ({
  text: '',
  images: [],
  state: 'idle',
  results: null,
  errorMessage: '',
  backgrounded: false,
  hydrated: false,

  setText: (t) => {
    set({ text: t });
    persistDraft(t, get().images);
  },

  setImages: (updater) => {
    const next = updater(get().images);
    set({ images: next });
    persistDraft(get().text, next);
  },

  clearDraft: () => {
    set({ text: '', images: [] });
    persistDraft('', []);
  },

  markBackgrounded: () => {
    // 요청이 도는 중일 때만 의미가 있다.
    if (get().state === 'loading') set({ backgrounded: true });
  },

  consumeResults: () => set({ results: null, state: 'idle' }),
  clearError: () => set({ errorMessage: '', state: 'idle' }),

  submit: async () => {
    const { text, images, state } = get();
    const trimmed = text.trim();
    // 중복 전송 방지 — 버튼을 두 번 눌러도 요청은 하나다.
    if (state === 'loading') return null;
    if (!trimmed && images.length === 0) return null;

    set({ state: 'loading', errorMessage: '', results: null, backgrounded: false });

    try {
      const results = images.length > 0
        ? await parseNaturalLanguageWithImages(
            trimmed,
            images.map(({ base64, mediaType }) => ({ base64, mediaType })),
          )
        : await parseNaturalLanguageMulti(trimmed);

      // 전부 실패한 경우만 에러로 취급한다(일부 성공은 그대로 진행).
      const allFailed = results.length > 0
        && results.every((r) => r.error && r.confidence === 'low');
      if (allFailed) {
        const first = results[0];
        set({
          state: 'error',
          errorMessage: get().backgrounded
            ? '앱을 벗어나 있는 동안 AI 요청이 중단됐어요. 화면을 켜 둔 채 다시 시도해 주세요.'
            : (first?.error ?? '잠시 후 다시 시도해 주세요.'),
        });
        return null;
      }

      // 🔑 성공했을 때만 초안을 비운다. 실패하면 사용자가 쓴 것을 그대로 남겨
      //    바로 다시 보낼 수 있게 한다.
      set({ state: 'done', results });
      get().clearDraft();
      return results;
    } catch (e) {
      void logError({ context: 'nl-request.submit', error: e });
      set({
        state: 'error',
        errorMessage: get().backgrounded
          ? '앱을 벗어나 있는 동안 AI 요청이 중단됐어요. 화면을 켜 둔 채 다시 시도해 주세요.'
          : (e instanceof Error ? e.message : '요청에 실패했어요.'),
      });
      return null;
    }
  },

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const raw = await AsyncStorage.getItem(NL_DRAFT_STORAGE_KEY);
      if (!raw) { set({ hydrated: true }); return; }
      const saved: PersistedDraft = JSON.parse(raw);

      /**
       * 사진은 uri 만 저장했으므로 파일에서 base64 를 다시 읽는다.
       * 앱 캐시가 정리됐거나 파일이 사라졌으면 **그 장만 조용히 버린다** —
       * 여기서 오류를 띄우면 사용자는 영문을 모른다.
       */
      const restored: NLAttachedImage[] = [];
      for (const uri of saved.imageUris ?? []) {
        try {
          const info = await FileSystem.getInfoAsync(uri);
          if (!info.exists) continue;
          const base64 = await FileSystem.readAsStringAsync(uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          // 형식은 바이트로 판정한다(확장자는 재인코딩 때문에 못 믿는다).
          const { resolveImageMediaType } = await import('@/lib/imageMediaType');
          restored.push({ uri, base64, mediaType: resolveImageMediaType(base64, uri) });
        } catch {
          // 이 장은 포기하고 나머지를 계속 복구한다.
        }
      }

      set({ text: saved.text ?? '', images: restored, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },
}));
