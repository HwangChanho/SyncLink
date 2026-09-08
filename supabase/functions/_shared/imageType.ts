/**
 * imageType — base64 이미지의 **실제** MIME 을 바이트로 판정한다.
 *
 * ## 왜 필요한가
 * 클라이언트는 `asset.uri` 의 **확장자**로 mediaType 을 정한다. 그런데
 * iOS ImagePicker 는 `quality` 옵션이 있으면 **JPEG 로 재인코딩**하면서도
 * uri 확장자는 원본(.png 등)을 남기는 경우가 있다. 그러면 선언과 바이트가
 * 어긋나 Anthropic 이 400 으로 거부한다:
 *
 *   The image was specified using the image/png media type,
 *   but the image appears to be a image/jpeg image
 *
 * 2026-09-08 LEAD 보고("사진 올려서 요청 보냈는데 안돼")의 실제 원인이 이것이었고,
 * 앱에는 `Edge Function returned a non-2xx status code` 로만 보였다.
 *
 * ## 왜 서버에서 고치나
 * 클라이언트도 고치지만 **스토어 배포에는 시간이 걸린다.** 서버가 바이트를 보고
 * 바로잡으면 **이미 나간 앱들까지 즉시 살아난다.**
 *
 * 🔑 판정은 매직 넘버로 한다 — 앞 24바이트면 충분해 base64 전체를 디코드하지 않는다.
 */

/** Anthropic vision 이 받는 이미지 MIME. */
export type SniffedImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

/**
 * base64 문자열의 실제 이미지 형식을 판정한다.
 *
 * @param b64 data URI 접두사가 붙어 있어도 되고 없어도 된다.
 * @returns 알아낸 MIME. 판정 불가(손상·미지원 형식)면 null.
 */
export function sniffImageMediaType(b64: string): SniffedImageMediaType | null {
  if (typeof b64 !== 'string' || b64.length === 0) return null;
  const raw = b64.replace(/^data:[^;]+;base64,/, '');

  let head: Uint8Array;
  try {
    // 32 base64 문자 = 24 바이트. 아래 시그니처는 전부 12바이트 안에 든다.
    const bin = atob(raw.slice(0, 32));
    head = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null; // base64 가 깨졌다
  }
  if (head.length < 12) return null;

  // JPEG: FF D8 FF
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 ("\x89PNG")
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image/png';
  // GIF: 47 49 46 ("GIF")
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return 'image/gif';
  // WEBP: "RIFF" ....(길이 4바이트).... "WEBP"
  if (
    head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
  ) return 'image/webp';

  return null;
}

/**
 * 선언된 mediaType 을 실제 바이트에 맞게 바로잡는다.
 *
 * @param b64      이미지 base64
 * @param declared 클라이언트가 보낸 mediaType (틀렸을 수 있다)
 * @returns 바이트로 판정한 형식. 판정 불가면 declared 를 그대로 돌려준다
 *          (형식 검증은 호출부의 허용목록이 계속 담당한다).
 */
export function resolveImageMediaType(b64: string, declared: string): string {
  const sniffed = sniffImageMediaType(b64);
  if (!sniffed) return declared;
  if (sniffed !== declared) {
    // 조용히 고치면 다음에 또 헤맨다 — 어긋났다는 사실은 로그로 남긴다.
    console.warn(`[imageType] mediaType 교정: ${declared} → ${sniffed}`);
  }
  return sniffed;
}
