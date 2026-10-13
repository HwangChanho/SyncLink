/**
 * photoDisplayUrlService — 저장된 사진 공개 URL → 표시용 서명 URL (2026-10-13, 보안 3-B3).
 *
 * 왜:
 *  - 일정 사진(event-images)·대화 사진(space-images)은 지금 공개 버킷이라 URL 만 알면 누구나 볼 수 있다.
 *  - 버킷을 비공개로 바꾸려면(3-C) 앱이 먼저 서명 URL(1시간 만료)로 표시해야 한다.
 *
 * 설계:
 *  - DB 에는 지금처럼 공개 URL 을 저장한다 — 옛 앱이 같은 행을 그대로 표시할 수 있게(호환).
 *  - 표시할 때만 URL 에서 버킷·경로를 뽑아 createSignedUrls 로 바꾼다.
 *  - 서명 실패(권한 정책 078 미적용·네트워크 등)면 원래 공개 URL 을 그대로 쓴다 — 버킷이 공개인 동안은 그대로 보인다.
 *  - 열람 권한은 migration 078: 그 일정·메시지를 볼 수 있는 사람만 서명 URL 을 받을 수 있다.
 *
 * 주의: 돌려준 URL 은 «표시 전용»이다. DB 에 다시 저장하지 말 것(1시간 뒤 만료된다).
 */

import { supabase } from '@/lib/supabase';

/** 서명 URL 유효 시간(초) — todoAttachmentService 와 같은 1시간. */
const SIGNED_URL_TTL = 60 * 60;

/** 서명 URL 로 바꿀 버킷 — 3-C 에서 비공개로 바꿀 대상. avatars 는 공개 유지라 넣지 않는다. */
const SIGNED_BUCKETS = ['event-images', 'space-images'] as const;
type SignedBucket = (typeof SIGNED_BUCKETS)[number];

/** getPublicUrl 이 만드는 공개 URL 의 경로 부분: `<프로젝트 URL>/storage/v1/object/public/<버킷>/<경로>` */
const PUBLIC_PATH_MARKER = '/storage/v1/object/public/';

/**
 * 공개 URL 에서 버킷·파일 경로를 뽑는다.
 *
 * @param url - DB 에 저장된 사진 URL
 * @returns 서명 대상 버킷의 공개 URL 이면 { bucket, path }, 아니면 null(로컬 file:// · 다른 버킷 · 이미 서명된 URL 등)
 */
export function parsePublicPhotoUrl(url: string): { bucket: SignedBucket; path: string } | null {
  const at = url.indexOf(PUBLIC_PATH_MARKER);
  if (at < 0) return null;

  // 쿼리 문자열(캐시 무효화용 ?t= 등)은 경로가 아니므로 버린다.
  const rest = url.slice(at + PUBLIC_PATH_MARKER.length).split('?')[0] ?? '';
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;

  const bucket = rest.slice(0, slash);
  if (!(SIGNED_BUCKETS as readonly string[]).includes(bucket)) return null;

  const path = decodeURIComponent(rest.slice(slash + 1));
  return path ? { bucket: bucket as SignedBucket, path } : null;
}

/**
 * 사진 URL 여러 개를 표시용 URL 로 한 번에 바꾼다(버킷마다 요청 1회).
 *
 * @param urls - 저장된 URL 배열. null 은 그대로 null.
 * @returns 같은 순서·같은 길이의 배열. 서명에 실패한 항목은 원래 URL 그대로.
 */
export async function toDisplayPhotoUrls(urls: (string | null)[]): Promise<(string | null)[]> {
  const out = [...urls];

  // 1) 버킷별로 «경로 → 이 경로를 쓰는 배열 위치들»을 모은다(같은 사진이 여러 번 나와도 한 번만 서명).
  const groups = new Map<SignedBucket, Map<string, number[]>>();
  urls.forEach((url, index) => {
    const parsed = url ? parsePublicPhotoUrl(url) : null;
    if (!parsed) return;
    const byPath = groups.get(parsed.bucket) ?? new Map<string, number[]>();
    byPath.set(parsed.path, [...(byPath.get(parsed.path) ?? []), index]);
    groups.set(parsed.bucket, byPath);
  });

  // 2) 버킷마다 createSignedUrls 한 번. 응답의 path 로 다시 짝지어 순서 가정에 기대지 않는다.
  await Promise.all([...groups].map(async ([bucket, byPath]) => {
    try {
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrls([...byPath.keys()], SIGNED_URL_TTL);
      if (error || !data) return;
      for (const item of data) {
        if (item.error || !item.signedUrl || !item.path) continue;
        for (const index of byPath.get(item.path) ?? []) out[index] = item.signedUrl;
      }
    } catch {
      // 네트워크 오류 등 — 원래 URL 을 유지한다(위 설계 참고).
    }
  }));

  return out;
}

/**
 * 사진 URL 하나를 표시용 URL 로 바꾼다. toDisplayPhotoUrls 의 한 개짜리 편의 함수.
 *
 * @param url - 저장된 URL (null 허용)
 * @returns 서명 URL, 실패하면 원래 URL
 */
export async function toDisplayPhotoUrl(url: string | null): Promise<string | null> {
  const [first] = await toDisplayPhotoUrls([url]);
  return first ?? null;
}
