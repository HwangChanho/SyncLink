/**
 * reward-credit Edge Function — AdMob Server-Side Verification (SSV) endpoint.
 *
 * AdMob invokes this URL over GET after a user completes a rewarded ad. We:
 *   1. Fetch Google's ECDSA public keys (cached) and verify the signature.
 *   2. Insert an `ad_reward_logs` row (unique transaction_id prevents replay).
 *   3. Increment `users.ai_ad_credits` by the reward_amount.
 *
 * Callback URL to register with AdMob:
 *   https://uhubhqcymxajdonmkthm.functions.supabase.co/reward-credit
 *
 * Required query params (per AdMob SSV spec):
 *   ad_network, ad_unit, reward_amount, reward_item, timestamp, transaction_id,
 *   user_id (we pass as custom_data), signature, key_id.
 *
 * We map the user id via AdMob's `custom_data` field — the client passes the
 * authenticated user's UUID when requesting the ad. SSV callbacks that fail
 * verification return HTTP 400 so AdMob retries later (or gives up, which is
 * fine — no credit granted is the safe default).
 *
 * Sprint 14 TASK-1405.
 */

// @ts-expect-error: Deno remote import — tsc cannot resolve but runtime can.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logToDb } from '../_shared/logger.ts';

declare const Deno: { env: { get(key: string): string | undefined } };

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Google-provided key set. Keys rotate infrequently so we cache in memory
 * for the lifetime of the function instance. A cache miss or stale key id
 * triggers a fresh fetch.
 */
const VERIFIER_KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';

interface GoogleKey {
  keyId: number;
  pem: string;
  base64: string;
}
interface KeyCache {
  fetchedAt: number;
  keys: GoogleKey[];
}
let cache: KeyCache | null = null;

/**
 * Fetch the current AdMob public key set. Returns the parsed list and
 * caches it for 6 hours (rotation cadence is much slower in practice).
 */
async function getGoogleKeys(forceRefresh = false): Promise<GoogleKey[]> {
  const now = Date.now();
  const ttlMs = 6 * 60 * 60 * 1000;
  if (!forceRefresh && cache && now - cache.fetchedAt < ttlMs) return cache.keys;

  const res = await fetch(VERIFIER_KEYS_URL);
  if (!res.ok) throw new Error(`verifier-keys fetch failed: ${res.status}`);
  const json = (await res.json()) as { keys: GoogleKey[] };
  cache = { fetchedAt: now, keys: json.keys };
  return json.keys;
}

// ─── Signature verification ──────────────────────────────────────────────────

/**
 * Verify the signature on an AdMob SSV callback. The message is the original
 * query string with the `signature` and `key_id` params removed, and the
 * signature algorithm is ECDSA over SHA-256.
 *
 * Throws on verification failure.
 */
async function verifySignature(rawUrl: URL): Promise<void> {
  const params = rawUrl.searchParams;
  const signatureB64 = params.get('signature');
  const keyIdStr = params.get('key_id');
  if (!signatureB64 || !keyIdStr) {
    throw new Error('missing signature/key_id');
  }

  // Rebuild the signed message: everything BEFORE `&signature=...&key_id=...`.
  // AdMob specifies that the last two params are exactly signature + key_id.
  const raw = rawUrl.search.startsWith('?') ? rawUrl.search.slice(1) : rawUrl.search;
  const sigIndex = raw.indexOf('&signature=');
  if (sigIndex === -1) throw new Error('signature delimiter not found');
  const message = raw.slice(0, sigIndex);

  // Find the matching PEM key.
  let keys = await getGoogleKeys();
  let keyEntry = keys.find((k) => String(k.keyId) === keyIdStr);
  if (!keyEntry) {
    // Refresh in case of a rotation.
    keys = await getGoogleKeys(true);
    keyEntry = keys.find((k) => String(k.keyId) === keyIdStr);
  }
  if (!keyEntry) throw new Error(`unknown key_id ${keyIdStr}`);

  // Import the PEM-encoded P-256 public key for ECDSA-SHA256 verification.
  const pemBody = keyEntry.pem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s+/g, '');
  const derBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'spki',
    derBytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );

  // AdMob sends a DER-encoded signature in URL-safe base64. Convert to raw
  // r||s bytes because SubtleCrypto.verify expects IEEE P1363 for ECDSA.
  const signatureDer = urlSafeB64ToBytes(signatureB64);
  const signatureRaw = derSignatureToRaw(signatureDer);

  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    signatureRaw,
    new TextEncoder().encode(message),
  );
  if (!ok) throw new Error('invalid signature');
}

/**
 * Decode a URL-safe base64 string (AdMob's encoding) to a Uint8Array.
 */
function urlSafeB64ToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const bin = atob(padded + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Convert a DER-encoded ECDSA signature to the raw r||s (P1363) form
 * expected by WebCrypto. The DER envelope is:
 *   SEQUENCE { INTEGER r, INTEGER s }
 * Each integer may include a leading 0x00 sign byte we must strip.
 */
function derSignatureToRaw(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new Error('not a DER sequence');
  // Skip SEQUENCE header (2 bytes).
  let offset = 2;
  if (der[offset++] !== 0x02) throw new Error('missing r INTEGER tag');
  const rLen = der[offset++];
  let r = der.slice(offset, offset + rLen);
  offset += rLen;
  if (der[offset++] !== 0x02) throw new Error('missing s INTEGER tag');
  const sLen = der[offset++];
  let s = der.slice(offset, offset + sLen);

  // Left-pad/trim to 32 bytes (P-256).
  const pad = (v: Uint8Array) => {
    if (v.length > 32) v = v.slice(v.length - 32);
    if (v.length === 32) return v;
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  r = pad(r);
  s = pad(s);

  const out = new Uint8Array(64);
  out.set(r, 0);
  out.set(s, 32);
  return out;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

// Permissive CORS so AdMob console's in-browser URL probe can reach the
// endpoint. Real SSV callbacks are server-to-server (no CORS), but the
// console verification runs from apps.admob.com in the user's browser.
const CORS_HEADERS: HeadersInit = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': '*',
};

function cors(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    ...init,
    headers: { ...(init.headers ?? {}), ...CORS_HEADERS },
  });
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return cors('', { status: 204 });
  }

  try {
    const url = new URL(req.url);

    // 0) AdMob console "URL 확인" probe pings the endpoint without query
    //    parameters to check reachability. Reply 200 so the console accepts
    //    the URL. Real SSV callbacks always include `signature` + `key_id`.
    if (!url.searchParams.has('signature') || !url.searchParams.has('key_id')) {
      return cors('reward-credit endpoint live', { status: 200 });
    }

    // 1) Verify signature. AdMob's console also sends a signed probe with a
    //    dummy signature/key that won't verify against the real verifier keys
    //    — in that case (and in any forged-callback case) we return 200 with
    //    no crediting. This keeps the console happy while denying bogus
    //    rewards silently. Real signed callbacks pass here and proceed.
    try {
      await verifySignature(url);
    } catch (err) {
      await logToDb('reward-credit.signature', err, {
        key_id: url.searchParams.get('key_id'),
      });
      return cors('signature not verified (ignored)', { status: 200 });
    }

    // 2) Extract fields.
    const params = url.searchParams;
    const adNetwork = params.get('ad_network') ?? 'admob';
    const adUnit = params.get('ad_unit') ?? '';
    const rewardItem = params.get('reward_item') ?? 'ai_credit';
    const rewardAmount = Number(params.get('reward_amount') ?? '0');
    const transactionId = params.get('transaction_id') ?? '';
    const customData = params.get('custom_data') ?? '';
    const userId = customData; // client passes user UUID as custom_data

    if (!transactionId) {
      return new Response('missing transaction_id', { status: 400 });
    }
    if (!userId) {
      return new Response('missing user_id (custom_data)', { status: 400 });
    }
    if (!Number.isFinite(rewardAmount) || rewardAmount <= 0) {
      return new Response('invalid reward_amount', { status: 400 });
    }

    // 3) Supabase service client (bypasses RLS).
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      await logToDb('reward-credit.env', new Error('missing SUPABASE envs'));
      return new Response('server misconfigured', { status: 500 });
    }
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 4) Insert audit row first. Unique(transaction_id) prevents double-spend.
    const { error: insertError } = await admin.from('ad_reward_logs').insert({
      user_id: userId,
      ad_network: adNetwork,
      ad_unit: adUnit,
      reward_item: rewardItem,
      reward_amount: rewardAmount,
      transaction_id: transactionId,
      custom_data: customData,
    });

    if (insertError) {
      // Unique-constraint violation (duplicate callback) → idempotent success.
      // Postgres error code 23505.
      const msg = insertError.message ?? '';
      if (msg.includes('duplicate') || msg.includes('23505')) {
        return cors('ok (duplicate)', { status: 200 });
      }
      await logToDb('reward-credit.insert', insertError, { userId, transactionId });
      return new Response('insert failed', { status: 500 });
    }

    // 5) Increment the credit balance. We RPC-style compute: fetch then update.
    // For a small user count + low traffic this is fine; under concurrency the
    // ad_reward_logs insert above is the true gate (unique tx id).
    const { data: userRow, error: readError } = await admin
      .from('users')
      .select('ai_ad_credits')
      .eq('id', userId)
      .single();
    if (readError) {
      await logToDb('reward-credit.read-user', readError, { userId });
      return new Response('user fetch failed', { status: 500 });
    }
    const newBalance = (userRow?.ai_ad_credits ?? 0) + rewardAmount;
    const { error: updateError } = await admin
      .from('users')
      .update({ ai_ad_credits: newBalance })
      .eq('id', userId);
    if (updateError) {
      await logToDb('reward-credit.update', updateError, { userId, newBalance });
      return new Response('update failed', { status: 500 });
    }

    // eslint-disable-next-line no-console
    console.log(
      `[reward-credit] +${rewardAmount} credits to ${userId} (tx ${transactionId}) in ${
        Date.now() - startedAt
      }ms`,
    );
    return cors('ok', { status: 200 });
  } catch (err) {
    await logToDb('reward-credit.handler', err);
    // Signature failures and malformed requests both end here. We return 400
    // so AdMob does NOT retry indefinitely for tampered callbacks.
    return new Response('bad request', { status: 400 });
  }
});
