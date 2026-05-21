#!/usr/bin/env node
// scripts/seed-ai-demo-data.mjs
//
// AI 비서 분석/인사이트 시나리오 검증용 demo 데이터 시드.
// 본인 계정 (cksgh0316@gmail.com) 에 다양한 패턴의 일정 ~80개 + 카테고리
// 6개 삽입.
//
// 패턴 (의미있는 분석 결과 나오게 의도):
//  - 사람 만남: 김철수(5), 박지영(3), 이민호(2), 그 외 1회씩 — "가장 많이
//    만난 사람" 분석 검증.
//  - 운동: 주 5회. 부위 분포 chest(8) > back(7) > legs(6) > shoulders(5) >
//    arms(5) > core(4) > cardio(3). event_kind='workout' + parts join.
//  - 러닝: 주 3회. distance 4~8km, pace 5:30~6:30. event_kind='running'.
//  - 가족/친구/취미/공부: 카테고리 분포.
//  - 시간대: 출근 전(07-08) / 점심(12-13) / 저녁(19-21) / 주말 분산.
//
// 사용:
//   node scripts/seed-ai-demo-data.mjs           # 시드
//   node scripts/seed-ai-demo-data.mjs --cleanup # 본 스크립트가 만든 것만 삭제 (description 마커 기준)
//
// 안전:
//   - description 에 "[ai-demo]" 마커 포함 → cleanup 시 그것만 삭제.
//   - service_role 사용 → RLS 우회.
//   - SUPABASE_SERVICE_ROLE_KEY 가 .env 에 있어야.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TARGET_EMAIL = process.env.SEED_TARGET_EMAIL ?? 'cksgh0316@gmail.com';
const MARKER       = '[ai-demo]';
const CLEANUP_ONLY = process.argv.includes('--cleanup');

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('💥 EXPO_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env');
  process.exit(1);
}
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── 카테고리 (이름 → 색) ──────────────────────────────────────────────────
const CATEGORIES = [
  { name: '업무', color: '#3B82F6' },
  { name: '운동', color: '#A1887F' }, // 헬스/러닝 갈색 통일
  { name: '가족', color: '#EC4899' },
  { name: '친구', color: '#10B981' },
  { name: '취미', color: '#F59E0B' },
  { name: '공부', color: '#8B5CF6' },
];

// ─── 사람 분포 — 같은 이름 반복으로 "가장 많이 만난 사람" 패턴 ─────────────
const FREQUENT_PEOPLE = [
  ['김철수',  5, '회의'],
  ['박지영',  3, '1:1 미팅'],
  ['이민호',  2, '점심'],
  ['최서연',  1, '커피챗'],
  ['정우진',  1, '리뷰'],
  ['한지민',  1, '저녁'],
];

const WORKOUT_DISTRIBUTION = [
  ['chest',     8],
  ['back',      7],
  ['legs',      6],
  ['shoulders', 5],
  ['arms',      5],
  ['core',      4],
  ['cardio',    3],
];

// ─── 헬퍼 ────────────────────────────────────────────────────────────────
function daysAgo(n, hour = 9, min = 0) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, min, 0, 0);
  return d;
}
function daysAhead(n, hour = 9, min = 0) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(hour, min, 0, 0);
  return d;
}
function plusHours(date, h) {
  const d = new Date(date);
  d.setHours(d.getHours() + h);
  return d;
}
const iso = (d) => d.toISOString();

async function findUserId(email) {
  // auth.users 는 service_role 로 admin API. public.users 는 동기화돼있음.
  const { data, error } = await admin.from('users').select('id, email').eq('email', email).single();
  if (error || !data) throw new Error(`user not found (${email}): ${error?.message}`);
  return data.id;
}

async function ensureCategories(userId) {
  // 같은 이름 + user_id 면 unique 제약. upsert 대신 select 후 missing 만 insert.
  const { data: existing, error: selErr } = await admin
    .from('categories').select('id, name').eq('user_id', userId);
  if (selErr) throw selErr;
  const existingNames = new Set((existing ?? []).map((c) => c.name));
  const missing = CATEGORIES
    .filter((c) => !existingNames.has(c.name))
    .map((c) => ({ user_id: userId, name: c.name, color: c.color }));
  if (missing.length > 0) {
    const { error } = await admin.from('categories').insert(missing);
    if (error) throw new Error(`category insert: ${error.message}`);
  }
  const { data: all, error: selErr2 } = await admin
    .from('categories').select('id, name').eq('user_id', userId);
  if (selErr2) throw selErr2;
  return Object.fromEntries(all.map((c) => [c.name, c.id]));
}

async function cleanup(userId) {
  const { error, count } = await admin
    .from('events').delete({ count: 'exact' })
    .eq('user_id', userId)
    .ilike('description', `${MARKER}%`);
  if (error) throw error;
  console.log(`🧹 cleanup: ${count ?? 0} events 삭제`);
}

// ─── 일정 빌더 ─────────────────────────────────────────────────────────
function buildEvents(userId, catId) {
  const events = [];
  const desc = (text) => `${MARKER} ${text}`;

  // 1) 사람 만남 — 지난 14일 분포
  let dayOffset = 14;
  for (const [name, count, kind] of FREQUENT_PEOPLE) {
    for (let i = 0; i < count; i++) {
      const start = daysAgo(dayOffset, 12 + (i % 2) * 7, 0); // 12 or 19시
      events.push({
        user_id:     userId,
        title:       `${name}와 ${kind}`,
        description: desc(`${name} 정기 만남 #${i + 1}`),
        start_at:    iso(start),
        end_at:      iso(plusHours(start, 1)),
        all_day:     false,
        category_id: catId('업무'),
        event_kind:  'general',
      });
      dayOffset -= 1;
      if (dayOffset < 1) dayOffset = 14;
    }
  }

  // 2) 운동 (workout) — 부위 분포 따라
  let workoutDay = 28;
  const workoutsForJoin = [];
  for (const [part, count] of WORKOUT_DISTRIBUTION) {
    for (let i = 0; i < count; i++) {
      const start = daysAgo(workoutDay, 7, 0); // 출근 전 운동
      const evt = {
        user_id:     userId,
        title:       `헬스 (${part})`,
        description: desc(`workout-${part}-${i + 1}`),
        start_at:    iso(start),
        end_at:      iso(plusHours(start, 1)),
        all_day:     false,
        category_id: catId('운동'),
        event_kind:  'workout',
        color:       '#A1887F',
      };
      events.push(evt);
      workoutsForJoin.push({ tempKey: evt.description, part });
      workoutDay -= 1;
      if (workoutDay < 1) workoutDay = 28;
    }
  }

  // 3) 러닝 (event_kind='running') — 주 3회, 4주 = 12회
  for (let i = 0; i < 12; i++) {
    const start = daysAgo(2 * i + 1, 19, 30); // 격일 저녁
    const distance = 4 + (i % 4); // 4~7 km 순환
    const pace = 330 + (i % 4) * 15; // 5:30~6:15
    events.push({
      user_id:          userId,
      title:            `러닝 ${distance}km`,
      description:      desc(`run-${i + 1}`),
      start_at:         iso(start),
      end_at:           iso(plusHours(start, 1)),
      all_day:          false,
      category_id:      catId('운동'),
      event_kind:       'running',
      distance_km:      distance,
      avg_pace_seconds: pace,
      color:            '#A1887F',
    });
  }

  // 4) 가족 — 주말 점심 4번
  for (let week = 0; week < 4; week++) {
    const start = daysAgo(week * 7 + 6, 12, 30); // 지난 토요일 점심
    events.push({
      user_id:     userId,
      title:       '엄마와 점심',
      description: desc(`family-lunch-${week}`),
      start_at:    iso(start),
      end_at:      iso(plusHours(start, 2)),
      all_day:     false,
      category_id: catId('가족'),
      event_kind:  'general',
    });
  }

  // 5) 친구 (다양한 이름, 가벼운 빈도) — 5건
  const friends = ['지훈', '수민', '도윤', '예린', '하준'];
  friends.forEach((name, i) => {
    const start = daysAgo(i * 4 + 2, 20, 0);
    events.push({
      user_id:     userId,
      title:       `${name}이랑 저녁`,
      description: desc(`friend-${name}`),
      start_at:    iso(start),
      end_at:      iso(plusHours(start, 2)),
      all_day:     false,
      category_id: catId('친구'),
      event_kind:  'general',
    });
  });

  // 6) 취미 — 영화/독서/게임 5건
  const hobbies = ['영화 관람', '독서', '게임', '드라이브', '카페 작업'];
  hobbies.forEach((name, i) => {
    const start = daysAgo(i * 3 + 1, 21, 0);
    events.push({
      user_id:     userId,
      title:       name,
      description: desc(`hobby-${i}`),
      start_at:    iso(start),
      end_at:      iso(plusHours(start, 2)),
      all_day:     false,
      category_id: catId('취미'),
      event_kind:  'general',
    });
  });

  // 7) 공부 — 평일 저녁 8건
  for (let i = 0; i < 8; i++) {
    const start = daysAgo(i + 1, 22, 0);
    events.push({
      user_id:     userId,
      title:       'TypeScript 강의',
      description: desc(`study-${i}`),
      start_at:    iso(start),
      end_at:      iso(plusHours(start, 1)),
      all_day:     false,
      category_id: catId('공부'),
      event_kind:  'general',
    });
  }

  // 8) 미래 (다음 주 분석용) — 가장 바쁜 날 만들기
  // 다음 화요일에 4건 몰아 넣음
  const tueOffset = ((9 - new Date().getDay()) % 7) || 7; // 다음 화요일
  for (let h = 9; h < 18; h += 2) {
    const start = daysAhead(tueOffset, h, 0);
    events.push({
      user_id:     userId,
      title:       `회의 슬롯 ${h}:00`,
      description: desc(`busy-tue-${h}`),
      start_at:    iso(start),
      end_at:      iso(plusHours(start, 1)),
      all_day:     false,
      category_id: catId('업무'),
      event_kind:  'general',
    });
  }
  // 다음 금요일은 비워둠 (빈 시간 추천 검증용)

  return { events, workoutsForJoin };
}

// ─── 메인 ─────────────────────────────────────────────────────────────
async function main() {
  console.log(`🎯 대상 계정: ${TARGET_EMAIL}`);
  const userId = await findUserId(TARGET_EMAIL);
  console.log(`   user_id: ${userId}`);

  if (CLEANUP_ONLY) {
    await cleanup(userId);
    console.log('✅ cleanup 완료');
    return;
  }

  // 1) cleanup 기존 ai-demo
  await cleanup(userId);

  // 2) 카테고리
  console.log('📁 카테고리 upsert...');
  const cats = await ensureCategories(userId);
  const catId = (name) => cats[name];

  // 3) 일정 + workout parts join
  const { events, workoutsForJoin } = buildEvents(userId, catId);
  console.log(`📅 ${events.length} events insert...`);
  // batch insert 50건 단위
  const inserted = [];
  for (let i = 0; i < events.length; i += 50) {
    const chunk = events.slice(i, i + 50);
    const { data, error } = await admin.from('events').insert(chunk).select('id, description');
    if (error) throw new Error(`insert: ${error.message}`);
    inserted.push(...data);
  }
  console.log(`   ✓ ${inserted.length} events`);

  // 4) event_workout_parts join (description 으로 매칭)
  const partRows = workoutsForJoin.map((w) => {
    const evt = inserted.find((e) => e.description === w.tempKey);
    return evt ? { event_id: evt.id, part: w.part } : null;
  }).filter(Boolean);
  if (partRows.length > 0) {
    const { error } = await admin.from('event_workout_parts').insert(partRows);
    if (error) console.warn(`⚠️ workout parts join 실패: ${error.message}`);
    else console.log(`   ✓ ${partRows.length} workout parts`);
  }

  console.log('\n✅ seed 완료');
  console.log('   분석 시도 예시:');
  console.log('   - "이번 주 일정 알려줘"');
  console.log('   - "최근 2주 가장 많이 만난 사람은?"');
  console.log('   - "이번 달 운동 부위 분포 분석해줘"');
  console.log('   - "다음 주 가장 바쁜 날과 빈 시간은?"');
}

main().catch((err) => { console.error('💥', err); process.exit(1); });
