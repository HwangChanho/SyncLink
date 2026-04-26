/**
 * contactService — adapter over expo-contacts.
 *
 * Wraps the OS contact book so the rest of the app can:
 *   1. Ask for permission once and remember the verdict.
 *   2. Pull a normalised, search-friendly list of contacts.
 *   3. Compose a SyncLink invite message addressed at a chosen contact.
 *
 * Why a service: same reason every other Supabase / OS bridge sits in
 * `src/services/` — components stay declarative, platform branching and
 * permission logic live behind a single import.
 *
 * Sprint 20 — LEAD requested contact-driven Space invitations.
 */

import { Platform } from 'react-native';
import * as Contacts from 'expo-contacts';

// ─── Public types ────────────────────────────────────────────────────────────

/**
 * Normalised contact row consumed by the UI.
 * Only the fields we actually render — the raw Contacts.Contact has
 * 30+ optional fields we never use.
 */
export interface ContactRow {
  id:        string;
  name:      string;
  /** First phone number (cleaned, no formatting) when available. */
  phone:     string | null;
  /** First email when available. */
  email:     string | null;
  /** Single character used for the picker avatar fallback. */
  initial:   string;
}

/** Result of a permission request — easier to switch on than the raw enum. */
export type ContactPermissionResult =
  | 'granted'
  | 'denied'
  | 'restricted'   // parental controls / MDM
  | 'unsupported'; // web

// ─── Cached permission verdict ───────────────────────────────────────────────

/**
 * In-memory cache of the most recent permission verdict. Avoids hitting
 * the OS prompt repeatedly when the user has already granted/denied.
 * Cleared on app cold start (RN process restart) — that's the right
 * granularity for permission state.
 */
let cachedPermission: ContactPermissionResult | null = null;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Ask the OS for contacts read access. Caches the verdict until the
 * process restarts; if the user previously denied, this returns 'denied'
 * without re-prompting (the OS won't show the dialog again either way).
 */
export async function requestContactsPermission(): Promise<ContactPermissionResult> {
  if (Platform.OS === 'web') {
    cachedPermission = 'unsupported';
    return cachedPermission;
  }
  if (cachedPermission && cachedPermission !== 'denied') {
    return cachedPermission;
  }
  const { status } = await Contacts.requestPermissionsAsync();
  // expo-contacts 12+ exposes PermissionStatus enum members as strings.
  // We map every non-granted state to 'denied' so the UI only has two
  // happy/sad branches to handle. The verbatim-string equality keeps us
  // forward-compatible if the SDK adds new statuses.
  cachedPermission = status === 'granted' ? 'granted' : 'denied';
  return cachedPermission;
}

/**
 * Read the address book and return a normalised row list. Caller is
 * responsible for filtering / searching client-side; we deliberately
 * fetch everything once to avoid per-keystroke OS roundtrips.
 *
 * Returns `[]` on web or when permission isn't granted.
 */
export async function getContacts(): Promise<ContactRow[]> {
  const perm = await requestContactsPermission();
  if (perm !== 'granted') return [];

  const { data } = await Contacts.getContactsAsync({
    fields: [
      Contacts.Fields.Name,
      Contacts.Fields.PhoneNumbers,
      Contacts.Fields.Emails,
    ],
  });

  return data
    .map(toContactRow)
    .filter((c): c is ContactRow => c !== null)
    // Korean ㄱ-ㅎ, English A-Z combined sort.
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

/**
 * Filter a contact list by a free-text query. Matches name, phone, and
 * email — case-insensitive, ignores spaces / dashes in phone numbers so
 * "010-1234" matches "01012345678".
 */
export function searchContacts(rows: ContactRow[], query: string): ContactRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  const qDigits = q.replace(/\D/g, '');
  return rows.filter((c) => {
    if (c.name.toLowerCase().includes(q)) return true;
    if (c.email?.toLowerCase().includes(q)) return true;
    if (c.phone) {
      const phoneDigits = c.phone.replace(/\D/g, '');
      if (qDigits.length > 0 && phoneDigits.includes(qDigits)) return true;
    }
    return false;
  });
}

/**
 * Build the canonical Space invite message for a single contact.
 * Kept here (not at the call site) so every channel — share sheet,
 * mailto, kakao deep link — uses the same phrasing.
 */
export function buildInviteMessage(
  spaceName: string,
  inviteCode: string,
  recipientName?: string,
): string {
  const greeting = recipientName ? `${recipientName}님,\n\n` : '';
  return [
    `${greeting}SyncLink Space "${spaceName}"에 초대합니다!`,
    `초대 코드: ${inviteCode}`,
    `참여 링크: synclink://space/join/${inviteCode}`,
  ].join('\n');
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

/** Reduce expo-contacts' wide shape to our minimal ContactRow. */
function toContactRow(raw: Contacts.Contact): ContactRow | null {
  const name = (raw.name ?? '').trim();
  if (!name) return null;
  const phone = raw.phoneNumbers?.[0]?.number?.trim() ?? null;
  const email = raw.emails?.[0]?.email?.trim() ?? null;
  // Skip rows that have no contact channel — useless for invites.
  if (!phone && !email) return null;
  // expo-contacts' Contact type omits `id` from its public typings even
  // though every implementation returns one — fall back to a synthetic
  // key when the field is missing so React lists stay stable.
  const rawId = (raw as unknown as { id?: string }).id;
  return {
    id:      rawId ?? `${name}-${phone ?? email ?? ''}`,
    name,
    phone,
    email,
    initial: name.charAt(0).toUpperCase(),
  };
}

// ─── Test helpers (not exported from index) ─────────────────────────────────

/** Reset the cached permission so unit tests can simulate a fresh launch. */
export function __resetContactPermissionCache(): void {
  cachedPermission = null;
}
