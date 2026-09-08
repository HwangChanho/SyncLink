/**
 * imageMediaType — 첨부 이미지의 **실제** MIME 을 base64 바이트로 판정한다.
 *
 * ## 왜 확장자로 하면 안 되나
 * 종전에는 `asset.uri` 의 확장자로 mediaType 을 정했다. 그런데 iOS ImagePicker 는
 * `quality` 옵션이 있으면 **JPEG 로 재인코딩**하면서도 uri 확장자는 원본(.png)을
 * 남기는 경우가 있다. 그러면 선언과 바이트가 어긋나 Anthropic 이 400 으로 거부한다:
 *
 *   The image was specified using the image/png media type,
 *   but the image appears to be a image/jpeg image
 *
 * 사용자 화면에는 `Edge Function returned a non-2xx status code` 로만 보여서
 * 원인을 알 수 없었다(2026-09-08 LEAD 보고).
 *
 * ⚠️ 서버(`supabase/functions/_shared/imageType.ts`)도 같은 판정을 해서 바로잡는다.
 *    거긴 **이미 나간 구버전 앱**을 구제하기 위한 것이고, 여기는 애초에 틀리지
 *    않게 하기 위한 것이다. 둘 중 하나만 두지 말 것.
 */

/** Anthropic vision 이 받는 이미지 MIME. */
export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

/**
 * base64 앞부분의 매직 넘버로 실제 형식을 판정한다.
 *
 * 전체를 디코드하지 않는다 — 아래 시그니처는 모두 앞 12바이트 안에 든다.
 *
 * @param b64 data URI 접두사가 붙어 있어도 된다.
 * @returns 알아낸 MIME. 판정 불가(손상·미지원 형식)면 null.
 */
export function sniffImageMediaType(b64: string): ImageMediaType | null {
  if (typeof b64 !== 'string' || b64.length === 0) return null;
  const raw = b64.replace(/^data:[^;]+;base64,/, '');

  let head: number[];
  try {
    // 32 base64 문자 = 24 바이트.
    const bin = globalThis.atob(raw.slice(0, 32));
    head = Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null; // base64 가 깨졌다
  }
  if (head.length < 12) return null;

  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image/png';
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return 'image/gif';
  if (
    head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
  ) return 'image/webp';

  return null;
}

/**
 * 이미지 하나의 mediaType 을 정한다. 바이트 판정이 최우선이고,
 * 판정이 안 될 때만 확장자로 떨어진다.
 *
 * @param b64 이미지 base64
 * @param uri 원본 uri (확장자 폴백용)
 * @returns 보낼 mediaType. 끝내 모르면 'image/jpeg'(가장 흔한 형식).
 */
export function resolveImageMediaType(b64: string, uri?: string): ImageMediaType {
  const sniffed = sniffImageMediaType(b64);
  if (sniffed) return sniffed;

  // 바이트로 못 알아낸 경우에만 확장자를 본다.
  const ext = uri?.split('?')[0]?.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}
