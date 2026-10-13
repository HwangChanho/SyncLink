/**
 * __tests__/lib/secureSessionStorage.test.ts
 *
 * 네이티브 세션 저장소: AsyncStorage → SecureStore 분할 저장 (2026-10-13, 보안 3-B4).
 *
 * 🔴 이 어댑터가 틀리면 앱 업데이트 순간 사용자 전원이 로그아웃된다. 지키는 성질:
 *  - 이전: AsyncStorage 세션을 옮기고 되읽어 같을 때만 원본 삭제 · 실패하면 원본 유지
 *  - 반쪽 값 금지: 쓰기가 중간에 실패해도 이전 값이 그대로 읽힌다
 *  - 순서 보장: 이전 도중 들어온 새 토큰을 옛 값이 덮지 않는다
 *  - 조각 하나는 2048바이트 이하 · 이모지(서로게이트 쌍)가 조각 경계에서 깨지지 않는다
 *  - 접근성: 첫 잠금 해제 이후 · 이 기기에서만
 *
 * expo-secure-store 는 jest.setup.js 의 메모리 Map mock(_store), AsyncStorage 는 공식 jest mock 을 쓴다.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { secureSessionStorage, splitByUtf8Bytes } from '@/lib/secureSessionStorage';

// ─── 준비 ────────────────────────────────────────────────────────────────────

/** jest.setup.js mock 이 노출한 SecureStore 내부 Map */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const secureMap: Map<string, string> = (SecureStore as any)._store;
const getMock = SecureStore.getItemAsync as jest.Mock;
const setMock = SecureStore.setItemAsync as jest.Mock;
const deleteMock = SecureStore.deleteItemAsync as jest.Mock;

const KEY = 'sb-proj-auth-token';

/** UTF-8 바이트 수 */
const utf8Bytes = (s: string) => Buffer.byteLength(s, 'utf8');

/** 실제 세션과 비슷한 크기·문자 구성(한글 닉네임·이모지 포함)의 JSON 문자열 */
function fakeSession(tag: string): string {
  return JSON.stringify({
    access_token: `${tag}.${'x'.repeat(1200)}`,
    refresh_token: `rt-${tag}`,
    expires_at: 1_900_000_000,
    user: {
      id: 'u1',
      user_metadata: { nickname: '우리하루 🐣 테스트'.repeat(40), avatar_url: 'https://example.com/a.jpg' },
      identities: Array.from({ length: 3 }, (_, i) => ({ provider: `p${i}`, data: 'y'.repeat(300) })),
    },
  });
}

beforeEach(async () => {
  secureMap.clear();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  // 테스트마다 실패 주입을 할 수 있으므로 기본 동작을 매번 되돌린다.
  getMock.mockImplementation((k: string) => Promise.resolve(secureMap.get(k) ?? null));
  setMock.mockImplementation((k: string, v: string) => { secureMap.set(k, v); return Promise.resolve(); });
  deleteMock.mockImplementation((k: string) => { secureMap.delete(k); return Promise.resolve(); });
});

// ─── splitByUtf8Bytes ────────────────────────────────────────────────────────

describe('splitByUtf8Bytes', () => {
  it('ASCII 는 바이트 상한마다 자른다', () => {
    expect(splitByUtf8Bytes('abcdefg', 3)).toEqual(['abc', 'def', 'g']);
  });

  it('한글(3바이트)은 글자 중간에서 자르지 않는다', () => {
    expect(splitByUtf8Bytes('가나다', 7)).toEqual(['가나', '다']);
  });

  it('이모지(4바이트·서로게이트 쌍)는 쪼개지지 않는다', () => {
    const chunks = splitByUtf8Bytes('a🐣b', 4);
    expect(chunks).toEqual(['a', '🐣', 'b']);
    expect(chunks.join('')).toBe('a🐣b');
  });

  it('빈 문자열 → 빈 배열', () => {
    expect(splitByUtf8Bytes('', 10)).toEqual([]);
  });
});

// ─── 쓰기·읽기 ───────────────────────────────────────────────────────────────

describe('setItem / getItem', () => {
  it('큰 세션을 조각으로 나눠 저장하고 그대로 되읽는다 (조각 ≤ 2048바이트)', async () => {
    const value = fakeSession('a');
    expect(utf8Bytes(value)).toBeGreaterThan(2048); // 전제: 실제로 쪼개야 하는 크기

    await secureSessionStorage.setItem(KEY, value);

    expect(await secureSessionStorage.getItem(KEY)).toBe(value);
    for (const [, stored] of secureMap) expect(utf8Bytes(stored)).toBeLessThanOrEqual(2048);
    // AsyncStorage 에는 남기지 않는다
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });

  it('첫 잠금 해제 이후 · 이 기기에서만 접근으로 저장한다', async () => {
    await secureSessionStorage.setItem(KEY, 'v');
    for (const call of setMock.mock.calls) {
      expect(call[2]).toEqual({ keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
    }
  });

  it('더 짧은 값으로 덮어쓰면 이전 세대 조각을 치운다', async () => {
    await secureSessionStorage.setItem(KEY, fakeSession('long'));
    await secureSessionStorage.setItem(KEY, 'short');

    expect(await secureSessionStorage.getItem(KEY)).toBe('short');
    // 목차 1개 + 조각 1개만 남는다
    expect([...secureMap.keys()].sort()).toEqual([KEY, `${KEY}.1.0`].sort());
  });

  it('없는 키 → null', async () => {
    expect(await secureSessionStorage.getItem(KEY)).toBeNull();
  });

  it('SecureStore 읽기가 throw 해도 getItem 은 throw 하지 않는다 (null)', async () => {
    getMock.mockRejectedValue(new Error('keychain unavailable'));
    expect(await secureSessionStorage.getItem(KEY)).toBeNull();
  });

  it('🔴 쓰기가 중간에 실패해도 반쪽 값이 아니라 이전 값이 읽힌다', async () => {
    const before = fakeSession('before');
    await secureSessionStorage.setItem(KEY, before);

    // 새 세대 두 번째 조각에서 실패 + 대체 경로(SecureStore 삭제·AsyncStorage 쓰기)까지 전부 실패하는 최악의 경우
    let writes = 0;
    setMock.mockImplementation((k: string, v: string) => {
      writes += 1;
      if (writes === 2) return Promise.reject(new Error('keychain write failed'));
      secureMap.set(k, v);
      return Promise.resolve();
    });
    deleteMock.mockRejectedValue(new Error('keychain delete failed'));
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));

    await expect(secureSessionStorage.setItem(KEY, fakeSession('after'))).rejects.toThrow('disk full');

    expect(await secureSessionStorage.getItem(KEY)).toBe(before);
  });

  it('SecureStore 쓰기가 실패하면 AsyncStorage 에 써서 로그인을 유지한다', async () => {
    setMock.mockRejectedValue(new Error('keychain write failed'));

    await secureSessionStorage.setItem(KEY, 'v1');

    expect(await AsyncStorage.getItem(KEY)).toBe('v1');
    expect(await secureSessionStorage.getItem(KEY)).toBe('v1');
  });
});

// ─── 이전(migration) ─────────────────────────────────────────────────────────

describe('AsyncStorage → SecureStore 이전', () => {
  it('첫 읽기 때 옮기고 원본을 지운다 (로그인 유지)', async () => {
    const legacy = fakeSession('legacy');
    await AsyncStorage.setItem(KEY, legacy);

    expect(await secureSessionStorage.getItem(KEY)).toBe(legacy);

    expect(await AsyncStorage.getItem(KEY)).toBeNull();
    expect(secureMap.has(KEY)).toBe(true);
    // 다음 읽기는 SecureStore 에서
    expect(await secureSessionStorage.getItem(KEY)).toBe(legacy);
  });

  it('SecureStore 쓰기 실패 → 원본 유지, 원본 값을 돌려준다', async () => {
    const legacy = fakeSession('legacy');
    await AsyncStorage.setItem(KEY, legacy);
    setMock.mockRejectedValue(new Error('keychain write failed'));

    expect(await secureSessionStorage.getItem(KEY)).toBe(legacy);
    expect(await AsyncStorage.getItem(KEY)).toBe(legacy);
  });

  it('되읽은 값이 다르면(조각 유실) → 원본 유지 + SecureStore 의 어긋난 값 삭제', async () => {
    const legacy = fakeSession('legacy');
    await AsyncStorage.setItem(KEY, legacy);
    // 첫 조각만 저장된 척 실제로는 버린다
    setMock.mockImplementation((k: string, v: string) => {
      if (k !== `${KEY}.0.0`) secureMap.set(k, v);
      return Promise.resolve();
    });

    expect(await secureSessionStorage.getItem(KEY)).toBe(legacy);
    expect(await AsyncStorage.getItem(KEY)).toBe(legacy);
    expect(secureMap.has(KEY)).toBe(false);
  });

  it('🔴 이전 도중 새 토큰이 저장돼도 옛 값이 덮어쓰지 않는다 (키별 순서 보장)', async () => {
    await AsyncStorage.setItem(KEY, fakeSession('old'));
    const fresh = fakeSession('new');

    // supabase-js(네이티브)는 잠금이 없어 읽기·쓰기가 겹칠 수 있다 — 동시에 시작
    const [read] = await Promise.all([
      secureSessionStorage.getItem(KEY),
      secureSessionStorage.setItem(KEY, fresh),
    ]);

    expect(read).toBe(fakeSession('old')); // 먼저 시작한 읽기는 옛 값을 본다
    expect(await secureSessionStorage.getItem(KEY)).toBe(fresh); // 최종 값은 새 토큰
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });
});

// ─── 삭제 ────────────────────────────────────────────────────────────────────

describe('removeItem', () => {
  it('목차·조각·AsyncStorage 사본까지 전부 지운다', async () => {
    await secureSessionStorage.setItem(KEY, fakeSession('a'));
    await AsyncStorage.setItem(KEY, 'leftover');

    await secureSessionStorage.removeItem(KEY);

    expect(secureMap.size).toBe(0);
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
    expect(await secureSessionStorage.getItem(KEY)).toBeNull();
  });

  it('목차 삭제 실패는 숨기지 않는다 (로그아웃이 실제로 안 된 것)', async () => {
    await secureSessionStorage.setItem(KEY, 'v');
    deleteMock.mockRejectedValue(new Error('keychain delete failed'));

    await expect(secureSessionStorage.removeItem(KEY)).rejects.toThrow('keychain delete failed');
  });
});
