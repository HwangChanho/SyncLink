#!/usr/bin/env node
/**
 * QA seed — 8 accounts (4 envs × Pro/Free) + 1 shared Space + 8 members.
 *
 * Idempotent: re-run safely. If account exists, it's skipped (auth signUp returns existing).
 * If Space invite_code exists, it's reused.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env (loaded via dotenv).
 *
 * Usage:
 *   node scripts/qa-seed-accounts.mjs
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { e2ePassword } from './lib/e2e-credentials.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Shared QA password. Kept out of the source because this repository is public.
const PASSWORD = e2ePassword();
const ACCOUNTS = [
  { env: 'ios-sim',         plan: 'pro',  email: 'e2e-ios-sim-pro@synclink.test',     nickname: 'iOS Sim Pro' },
  { env: 'ios-sim',         plan: 'free', email: 'e2e-ios-sim-free@synclink.test',    nickname: 'iOS Sim Free' },
  { env: 'android-sim',     plan: 'pro',  email: 'e2e-android-sim-pro@synclink.test', nickname: 'AND Sim Pro' },
  { env: 'android-sim',     plan: 'free', email: 'e2e-android-sim-free@synclink.test',nickname: 'AND Sim Free' },
  { env: 'android-device',  plan: 'pro',  email: 'e2e-android-dev-pro@synclink.test', nickname: 'AND Dev Pro' },
  { env: 'android-device',  plan: 'free', email: 'e2e-android-dev-free@synclink.test',nickname: 'AND Dev Free' },
  { env: 'web',             plan: 'pro',  email: 'e2e-web-pro@synclink.test',         nickname: 'Web Pro' },
  { env: 'web',             plan: 'free', email: 'e2e-web-free@synclink.test',        nickname: 'Web Free' },
];

const SPACE_NAME = 'E2E Test Space';
const SPACE_INVITE = 'E2ETST';

async function ensureUser(account) {
  const { data: existingList } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const existing = existingList?.users?.find((u) => u.email === account.email);
  if (existing) {
    // Keep the stored password in step with .env. That makes rotation a one-liner:
    // change E2E_PASSWORD and re-run this script, and every QA account follows.
    const { error } = await supabase.auth.admin.updateUserById(existing.id, { password: PASSWORD });
    if (error) throw new Error(`updateUser ${account.email}: ${error.message}`);
    return { id: existing.id, created: false, passwordSynced: true };
  }
  const { data, error } = await supabase.auth.admin.createUser({
    email: account.email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { nickname: account.nickname },
  });
  if (error) throw new Error(`createUser ${account.email}: ${error.message}`);
  return { id: data.user.id, created: true };
}

async function setNicknameAndPlan(userId, account) {
  const update = { nickname: account.nickname };
  if (account.plan === 'pro') update.subscription_plan = 'pro';
  const { error } = await supabase.from('users').update(update).eq('id', userId);
  if (error) throw new Error(`update users ${account.email}: ${error.message}`);
}

async function ensureSpace(ownerId) {
  const { data: existing } = await supabase
    .from('spaces').select('*').eq('invite_code', SPACE_INVITE).maybeSingle();
  if (existing) return existing;
  const { data, error } = await supabase
    .from('spaces')
    .insert({
      name: SPACE_NAME,
      type: 'group',
      invite_code: SPACE_INVITE,
      created_by: ownerId,
    })
    .select().single();
  if (error) throw new Error(`create space: ${error.message}`);
  return data;
}

async function ensureMember(spaceId, userId, role, color) {
  const { data: existing } = await supabase
    .from('space_members').select('*')
    .eq('space_id', spaceId).eq('user_id', userId).maybeSingle();
  if (existing) return false;
  const { error } = await supabase.from('space_members').insert({
    space_id: spaceId, user_id: userId, role, color,
  });
  if (error) throw new Error(`add member ${userId}: ${error.message}`);
  return true;
}

const COLORS = ['#6C63FF', '#FF6B6B', '#4ECDC4', '#FFD166', '#06D6A0', '#118AB2', '#EF476F', '#073B4C'];

async function main() {
  console.log('— QA seed start —');
  const userIds = {};
  for (const a of ACCOUNTS) {
    const { id, created } = await ensureUser(a);
    userIds[a.email] = id;
    await setNicknameAndPlan(id, a);
    console.log(`  ${created ? '+ NEW' : '  EXIST'} ${a.email} (${a.plan})`);
  }

  const owner = ACCOUNTS[0]; // iOS Sim Pro = owner
  const space = await ensureSpace(userIds[owner.email]);
  console.log(`  Space "${space.name}" (id=${space.id}, invite=${space.invite_code})`);

  let added = 0;
  for (let i = 0; i < ACCOUNTS.length; i++) {
    const a = ACCOUNTS[i];
    const role = a === owner ? 'owner' : 'member';
    const isNew = await ensureMember(space.id, userIds[a.email], role, COLORS[i]);
    if (isNew) added++;
    console.log(`  ${isNew ? '+ JOIN' : '  IN  '} ${a.email} (${role})`);
  }
  console.log(`— done — ${ACCOUNTS.length} users, space ${space.invite_code}, ${added} new members —`);
}

main().catch((e) => { console.error(e); process.exit(1); });
