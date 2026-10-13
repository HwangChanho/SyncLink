/**
 * __tests__/services/photoDisplayUrlService.test.ts
 *
 * 사진 공개 URL → 표시용 서명 URL 변환 (2026-10-13, 보안 3-B3).
 *
 * 커버리지:
 *  parsePublicPhotoUrl — 대상 버킷만 · 쿼리 문자열 제거 · 로컬/다른 버킷/서명 URL 은 null
 *  toDisplayPhotoUrls  — 버킷별 1회 요청 · 같은 경로 중복 1회 · 응답 path 로 짝짓기 ·
 *                        항목 오류·요청 오류·예외 시 원래 URL 유지 · null·대상 아님은 그대로
 *  toDisplayPhotoUrl   — 단건 편의 함수
 */

// ─── Mock 선언 ────────────────────────────────────────────────────────────────

jest.mock('@/lib/supabase', () => {
  const createSignedUrls = jest.fn();
  const storageFrom = jest.fn(() => ({ createSignedUrls }));
  return {
    supabase: { storage: { from: storageFrom } },
    __createSignedUrls: createSignedUrls,
    __storageFrom: storageFrom,
  };
});

// ─── Imports ──────────────────────────────────────────────────────────────────

import {
  parsePublicPhotoUrl,
  toDisplayPhotoUrls,
  toDisplayPhotoUrl,
} from '@/services/photoDisplayUrlService';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { __createSignedUrls: createSignedUrls, __storageFrom: storageFrom } = require('@/lib/supabase') as any;

// ─── 픽스처 ───────────────────────────────────────────────────────────────────

const BASE = 'https://proj.supabase.co/storage/v1/object/public';
const EVENT_URL = `${BASE}/event-images/u1/e1/0.jpg`;
const EVENT_URL_2 = `${BASE}/event-images/u1/e1/1.jpg`;
const MSG_URL = `${BASE}/space-images/u1/messages/m1.jpg`;
const AVATAR_URL = `${BASE}/avatars/u1/a.jpg`;

/** createSignedUrls 성공 응답 한 항목 */
const signed = (path: string) => ({ path, signedUrl: `https://signed/${path}`, error: null });

// ─── 테스트 ───────────────────────────────────────────────────────────────────

describe('parsePublicPhotoUrl', () => {
  it('일정 사진 공개 URL → 버킷·경로', () => {
    expect(parsePublicPhotoUrl(EVENT_URL)).toEqual({ bucket: 'event-images', path: 'u1/e1/0.jpg' });
  });

  it('대화 사진 공개 URL + 쿼리 문자열 → 쿼리는 버린다', () => {
    expect(parsePublicPhotoUrl(`${MSG_URL}?t=123`)).toEqual({ bucket: 'space-images', path: 'u1/messages/m1.jpg' });
  });

  it.each([
    ['아바타(공개 유지 버킷)', AVATAR_URL],
    ['로컬 파일', 'file:///tmp/x.jpg'],
    ['이미 서명된 URL', 'https://proj.supabase.co/storage/v1/object/sign/event-images/u1/e1/0.jpg?token=x'],
    ['버킷만 있고 경로 없음', `${BASE}/event-images/`],
  ])('%s → null', (_label, url) => {
    expect(parsePublicPhotoUrl(url)).toBeNull();
  });
});

describe('toDisplayPhotoUrls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('버킷마다 한 번씩 서명하고 같은 순서로 돌려준다 (null·대상 아님은 그대로)', async () => {
    createSignedUrls
      .mockResolvedValueOnce({ data: [signed('u1/e1/0.jpg')], error: null })
      .mockResolvedValueOnce({ data: [signed('u1/messages/m1.jpg')], error: null });

    const result = await toDisplayPhotoUrls([EVENT_URL, null, AVATAR_URL, MSG_URL]);

    expect(storageFrom).toHaveBeenCalledTimes(2);
    expect(storageFrom).toHaveBeenCalledWith('event-images');
    expect(storageFrom).toHaveBeenCalledWith('space-images');
    expect(result).toEqual([
      'https://signed/u1/e1/0.jpg', null, AVATAR_URL, 'https://signed/u1/messages/m1.jpg',
    ]);
  });

  it('같은 경로가 여러 번 나오면 한 번만 서명해 모두 채운다', async () => {
    createSignedUrls.mockResolvedValueOnce({ data: [signed('u1/e1/0.jpg')], error: null });

    const result = await toDisplayPhotoUrls([EVENT_URL, EVENT_URL]);

    expect(createSignedUrls).toHaveBeenCalledWith(['u1/e1/0.jpg'], 3600);
    expect(result).toEqual(['https://signed/u1/e1/0.jpg', 'https://signed/u1/e1/0.jpg']);
  });

  it('응답 순서가 달라도 path 로 짝짓는다', async () => {
    createSignedUrls.mockResolvedValueOnce({
      data: [signed('u1/e1/1.jpg'), signed('u1/e1/0.jpg')], error: null,
    });

    const result = await toDisplayPhotoUrls([EVENT_URL, EVENT_URL_2]);

    expect(result).toEqual(['https://signed/u1/e1/0.jpg', 'https://signed/u1/e1/1.jpg']);
  });

  it('항목별 오류(권한 없음 등)는 그 항목만 원래 URL 유지', async () => {
    createSignedUrls.mockResolvedValueOnce({
      data: [signed('u1/e1/0.jpg'), { path: 'u1/e1/1.jpg', signedUrl: null, error: 'Either the object does not exist or you do not have access to it' }],
      error: null,
    });

    const result = await toDisplayPhotoUrls([EVENT_URL, EVENT_URL_2]);

    expect(result).toEqual(['https://signed/u1/e1/0.jpg', EVENT_URL_2]);
  });

  it('요청 오류 → 원래 URL 그대로', async () => {
    createSignedUrls.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });

    expect(await toDisplayPhotoUrls([EVENT_URL])).toEqual([EVENT_URL]);
  });

  it('예외(네트워크) → 원래 URL 그대로, throw 하지 않는다', async () => {
    createSignedUrls.mockRejectedValueOnce(new Error('network'));

    expect(await toDisplayPhotoUrls([MSG_URL])).toEqual([MSG_URL]);
  });

  it('서명할 것이 없으면 요청하지 않는다', async () => {
    expect(await toDisplayPhotoUrls([null, AVATAR_URL, 'file:///x.jpg'])).toEqual([null, AVATAR_URL, 'file:///x.jpg']);
    expect(storageFrom).not.toHaveBeenCalled();
  });
});

describe('toDisplayPhotoUrl', () => {
  beforeEach(() => jest.clearAllMocks());

  it('단건 서명', async () => {
    createSignedUrls.mockResolvedValueOnce({ data: [signed('u1/messages/m1.jpg')], error: null });

    expect(await toDisplayPhotoUrl(MSG_URL)).toBe('https://signed/u1/messages/m1.jpg');
  });

  it('null → null', async () => {
    expect(await toDisplayPhotoUrl(null)).toBeNull();
  });
});
