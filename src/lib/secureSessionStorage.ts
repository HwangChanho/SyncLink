/**
 * secureSessionStorage — 네이티브 로그인 세션 저장소 (2026-10-13, 보안 3-B4).
 *
 * 왜:
 *  - 지금까지 세션(액세스·리프레시 토큰)은 AsyncStorage(암호화 없는 앱 파일)에 있었다.
 *    기기 백업에 그대로 실리고, 파일에 접근할 수 있으면 그대로 읽힌다.
 *  - 여기서는 SecureStore(iOS Keychain · Android Keystore 암호화)에 둔다.
 *    접근성은 «첫 잠금 해제 이후 · 이 기기에서만» — 잠긴 상태의 백그라운드 갱신도 읽을 수 있고,
 *    백업으로 다른 기기에 옮겨지지 않는다.
 *
 * 설계 (supabase-js 의 storage 인터페이스 getItem/setItem/removeItem 을 그대로 구현):
 *  1) 쪼개 저장 — SecureStore 값은 2048바이트 제한이 있는데 세션 JSON 은 그보다 크다.
 *     값을 UTF-8 기준 MAX_CHUNK_BYTES 이하 조각으로 나눠 `${key}.${세대}.${순번}` 에 두고,
 *     `${key}` 자리에는 목차(manifest: 세대·조각 수)만 둔다.
 *  2) 세대 교대 — 새 값은 «지금 목차가 가리키지 않는 세대»에 먼저 다 쓰고, 마지막에 목차를 바꾼다.
 *     중간에 앱이 죽어도 목차는 이전 세대를 가리키므로 이전 값이 온전하다.
 *     🔴 supabase-js 는 저장소가 깨진 값을 돌려주면 세션을 지운다(_removeSession) → 반쪽짜리 값은 곧 로그아웃이다.
 *  3) 키별 순서 보장 — 네이티브의 supabase-js 는 잠금이 없어(lockNoOp) 읽기·쓰기가 겹칠 수 있다.
 *     같은 키의 작업은 한 줄로 세워 차례로 실행한다(이전 중 갱신된 새 토큰을 옛 값이 덮는 일 방지).
 *  4) 이전(migration) — 첫 읽기 때 SecureStore 에 없고 AsyncStorage 에 있으면 옮긴다.
 *     옮긴 뒤 되읽어 같을 때만 AsyncStorage 원본을 지운다. 실패하면 원본을 그대로 두고 그 값을 돌려준다
 *     → 어떤 경우에도 «업데이트했더니 로그아웃»이 되지 않게 한다.
 *  5) SecureStore 쓰기 실패 시 AsyncStorage 로 되돌아간다(로그인 유지가 우선). 다음 읽기 때 다시 옮겨 본다.
 *
 * 주의:
 *  - 네이티브 전용. 웹은 supabase.ts 에서 localStorage 를 그대로 쓴다.
 *  - 이전 후 옛 JS(OTA 롤백)로 돌아가면 옛 코드는 AsyncStorage 만 보므로 한 번 로그아웃된다.
 *  - iOS Keychain 은 앱을 지웠다 다시 깔아도 남는다 → 재설치 후에도 로그인이 유지될 수 있다(AsyncStorage 시절엔 로그아웃).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/** 조각 하나의 최대 UTF-8 바이트 — SecureStore 제한(2048)보다 여유 있게. */
const MAX_CHUNK_BYTES = 1800;

/** 첫 잠금 해제 이후 접근 가능 · 이 기기에서만(백업으로 다른 기기에 옮겨지지 않음). */
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/** 목차 — `${key}` 자리에 JSON 으로 둔다. g = 세대(0|1), n = 조각 수. */
interface Manifest {
  v: 1;
  g: 0 | 1;
  n: number;
}

/** 조각 키. SecureStore 키 허용 문자(영숫자 . - _)만 쓴다. */
function chunkKey(key: string, generation: 0 | 1, index: number): string {
  return `${key}.${generation}.${index}`;
}

/**
 * 문자열을 UTF-8 바이트 기준으로 자른다.
 *
 * 코드 포인트 단위로 돈다(for-of) — 이모지 같은 서로게이트 쌍이 두 조각으로 갈리면
 * 네이티브로 넘어가며 깨진 문자로 바뀌어 다시 이어 붙여도 원래 값이 안 된다.
 *
 * @param value    - 자를 문자열
 * @param maxBytes - 조각 하나의 최대 바이트
 * @returns 조각 배열(빈 문자열이면 빈 배열)
 */
export function splitByUtf8Bytes(value: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of value) {
    const cp = ch.codePointAt(0) ?? 0;
    const size = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes + size > maxBytes && current) {
      chunks.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * 목차를 읽는다.
 *
 * @returns 목차, 없거나 알아볼 수 없으면 null
 * @throws SecureStore 읽기 자체가 실패하면 그대로 throw(호출부가 판단)
 */
async function readManifest(key: string): Promise<Manifest | null> {
  const raw = await SecureStore.getItemAsync(key, SECURE_OPTIONS);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Manifest>;
    if (parsed.v === 1 && (parsed.g === 0 || parsed.g === 1) && typeof parsed.n === 'number') {
      return parsed as Manifest;
    }
  } catch {
    // 목차가 아니다 — 아래에서 null
  }
  return null;
}

/**
 * SecureStore 에서 값을 읽어 조각을 이어 붙인다.
 *
 * @returns 값. 목차가 없거나 조각이 하나라도 없으면 null(반쪽 값을 돌려주지 않는다 — 위 설계 2 참고)
 * @throws SecureStore 읽기 실패
 */
async function readSecure(key: string): Promise<string | null> {
  const manifest = await readManifest(key);
  if (!manifest) return null;
  const parts = await Promise.all(
    Array.from({ length: manifest.n }, (_, i) => SecureStore.getItemAsync(chunkKey(key, manifest.g, i), SECURE_OPTIONS)),
  );
  if (parts.some((part) => part === null)) return null;
  return parts.join('');
}

/**
 * SecureStore 에 값을 쓴다 — 새 세대에 조각을 다 쓴 뒤 목차를 바꾸고, 이전 세대 조각을 치운다.
 *
 * @throws 조각·목차 쓰기 실패(이 경우 목차는 여전히 이전 값을 가리킨다)
 */
async function writeSecure(key: string, value: string): Promise<void> {
  const previous = await readManifest(key);
  const generation: 0 | 1 = previous?.g === 0 ? 1 : 0;
  const chunks = splitByUtf8Bytes(value, MAX_CHUNK_BYTES);

  // 1) 새 세대 조각 — 순서대로(동시에 수십 개를 Keychain 에 밀어 넣지 않는다)
  for (const [i, chunk] of chunks.entries()) {
    await SecureStore.setItemAsync(chunkKey(key, generation, i), chunk, SECURE_OPTIONS);
  }
  // 2) 목차 교체 = 확정 시점
  const manifest: Manifest = { v: 1, g: generation, n: chunks.length };
  await SecureStore.setItemAsync(key, JSON.stringify(manifest), SECURE_OPTIONS);

  // 3) 이전 세대 조각 정리 — 실패해도 값은 이미 확정됐으므로 무시(남은 조각은 목차가 안 가리켜 읽히지 않는다)
  if (previous) {
    for (let i = 0; i < previous.n; i += 1) {
      await SecureStore.deleteItemAsync(chunkKey(key, previous.g, i), SECURE_OPTIONS).catch(() => undefined);
    }
  }
}

/**
 * SecureStore 에서 값을 지운다 — 목차를 먼저 지운다(목차가 없으면 조각은 읽히지 않는다).
 *
 * @throws 목차 삭제 실패(로그아웃이 실제로 안 된 것이므로 숨기지 않는다)
 */
async function deleteSecure(key: string): Promise<void> {
  const manifest = await readManifest(key).catch(() => null);
  await SecureStore.deleteItemAsync(key, SECURE_OPTIONS);
  if (manifest) {
    for (let i = 0; i < manifest.n; i += 1) {
      await SecureStore.deleteItemAsync(chunkKey(key, manifest.g, i), SECURE_OPTIONS).catch(() => undefined);
    }
  }
}

/** 키별 작업 줄 — 같은 키의 작업은 앞 작업이 끝난 뒤 시작한다. 키는 세션·PKCE 검증값 정도라 지우지 않는다. */
const queues = new Map<string, Promise<unknown>>();

/**
 * 같은 키의 작업을 차례로 실행한다(앞 작업의 실패는 뒤 작업에 영향을 주지 않는다).
 *
 * @param key - 저장 키
 * @param op  - 실행할 작업
 * @returns op 의 결과
 */
function serialized<T>(key: string, op: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(op);
  queues.set(key, next);
  return next;
}

/**
 * 값을 읽는다. SecureStore 에 없고 AsyncStorage 에 있으면 그때 옮긴다(설계 4).
 *
 * @param key - supabase-js 저장 키(예: sb-<프로젝트>-auth-token)
 * @returns 값 또는 null. 절대 throw 하지 않는다 — 읽기 실패는 «없음»으로 본다(null 은 supabase 가 세션을 지우지 않는다).
 */
function getItem(key: string): Promise<string | null> {
  return serialized(key, async () => {
    try {
      const secure = await readSecure(key);
      if (secure !== null) return secure;
    } catch {
      // Keychain/Keystore 읽기 실패 — 아래 AsyncStorage 로 넘어간다
    }

    const legacy = await AsyncStorage.getItem(key).catch(() => null);
    if (legacy === null) return null;

    // 이전: 쓰고 → 되읽어 같으면 → 원본 삭제. 어느 단계든 실패하면 원본 유지.
    try {
      await writeSecure(key, legacy);
      if ((await readSecure(key)) !== legacy) throw new Error('secure session read-back mismatch');
      await AsyncStorage.removeItem(key);
    } catch {
      // 다음 읽기에서 SecureStore 의 어긋난 값이 원본을 가리지 않게 지운다(실패해도 무시).
      await deleteSecure(key).catch(() => undefined);
    }
    return legacy;
  });
}

/**
 * 값을 쓴다. SecureStore 가 실패하면 AsyncStorage 에 쓴다(설계 5).
 *
 * @param key   - 저장 키
 * @param value - 저장할 값(supabase-js 가 JSON 문자열로 넘긴다)
 */
function setItem(key: string, value: string): Promise<void> {
  return serialized(key, async () => {
    try {
      await writeSecure(key, value);
      // 이전에 실패해 남아 있던 AsyncStorage 사본 정리(없으면 아무 일 없음)
      await AsyncStorage.removeItem(key).catch(() => undefined);
    } catch {
      // SecureStore 의 이전 값이 새 값을 가리지 않도록 지운 뒤 AsyncStorage 에 쓴다.
      await deleteSecure(key).catch(() => undefined);
      await AsyncStorage.setItem(key, value);
    }
  });
}

/**
 * 값을 지운다(로그아웃 등). 양쪽 모두에서 지운다.
 *
 * @param key - 저장 키
 * @throws SecureStore 목차 삭제 실패 — 세션이 남아 있다는 뜻이라 숨기지 않는다
 */
function removeItem(key: string): Promise<void> {
  return serialized(key, async () => {
    await AsyncStorage.removeItem(key).catch(() => undefined);
    await deleteSecure(key);
  });
}

/** supabase-js `auth.storage` 에 넘기는 어댑터(네이티브 전용). */
export const secureSessionStorage = { getItem, setItem, removeItem };
