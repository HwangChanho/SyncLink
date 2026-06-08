-- Migration 062 — 계정 통합 v3 (전수 이전 + 스페이스 무결성 + 데이터 소실 가드).
--
-- 배경: 061 merge_account_v2 는 "옮길 테이블을 일일이 나열"하는 allowlist 방식이라,
--       public.users 를 FK 로 참조하는 테이블 중 나열에서 빠진 것은 secondary 삭제 시
--       CASCADE 로 조용히 소실됐다. 실제로 다음이 누락되어 통합 시 사라졌다:
--         - space_messages(sender_id)   — 스페이스 채팅 메시지
--         - event_comments(user_id)     — 일정 댓글
--         - event_reactions(user_id)    — 일정 반응
--         - event_reminders(user_id)    — 일정 리마인더
--
-- v3 설계 원칙:
--   1) 전수 이전(denylist): users(public/auth)를 참조하는 FK 를 모두 이전 대상으로 보고,
--      "버려도 되는" 로그/토큰류만 명시적으로 제외(denylist). 새 데이터 테이블이 생겨도
--      기본은 '보존' 쪽이다.
--   2) 데이터 소실 가드: public.users 삭제 직전, pg_constraint 를 순회해 denylist 가 아닌
--      테이블에 secondary 가 아직 참조로 남아 있으면 RAISE → 트랜잭션 롤백. 즉 "빠뜨리면
--      조용히 소실" 대신 "빠뜨리면 통합이 실패"하도록 뒤집어, 미래의 새 FK 테이블도
--      자동으로 탐지된다. (SET NULL FK 는 행이 익명화될 뿐 소실이 아니므로 가드에서 제외.)
--   3) 스페이스/반응 무결성: UNIQUE 제약이 있는 space_members(space_id,user_id) 와
--      event_reactions(event_id,user_id,emoji) 는 충돌 행을 먼저 정리한 뒤 이전.
--   4) 보안 모델은 v2 와 동일 — service_role 전용, Edge account-merge-bytoken 의 양토큰
--      검증이 '둘 다 본인 소유'를 보장한다. auth.uid()/same-email 체크는 의도적으로 없음.
--
-- denylist (이전하지 않음 — secondary 와 함께 정리/익명화되어도 무방):
--   external_sync_log, google_oauth_tokens, notification_logs  (CASCADE 로그/토큰)
--   error_logs        (SET NULL — user_id 만 NULL 로 익명화, 행은 보존)
--   app_admins        (auth CASCADE — 관리자 권한 행, secondary 로 통합 대상 아님)

-- ── 토큰 기반 병합 v3 (service_role 전용) ──────────────────────────────────────
create or replace function merge_account_v3(
  p_primary         uuid,
  p_secondary       uuid,
  p_conflict_policy text default 'keep_both'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_primary_email   text;
  v_secondary_email text;
  v_primary_plan    text;
  v_secondary_plan  text;
  v_both_pro        boolean := false;
  v_moved_events    int := 0;
  v_moved_messages  int := 0;
  v_moved_comments  int := 0;
  v_moved_reactions int := 0;
  v_moved_reminders int := 0;
  v_moved_idents    int := 0;
  v_deduped         int := 0;
  -- 이전하지 않을(=secondary 와 함께 사라져도 되는) 테이블. 가드에서도 제외된다.
  v_denylist        text[] := array[
    'external_sync_log', 'google_oauth_tokens', 'notification_logs',
    'error_logs', 'app_admins'
  ];
  rec       record;
  v_exists  boolean;
begin
  -- ── 0. 입력 검증 (auth.uid()/same-email 체크는 의도적으로 없음 — 상단 주석 참조) ──
  if p_primary is null or p_secondary is null then
    raise exception 'primary and secondary required';
  end if;
  if p_primary = p_secondary then
    raise exception 'primary and secondary must differ';
  end if;
  if p_conflict_policy not in ('keep_both', 'dedupe') then
    raise exception 'invalid conflict policy: %', p_conflict_policy;
  end if;

  select email, coalesce(subscription_plan, 'free')
    into v_primary_email, v_primary_plan
    from public.users where id = p_primary;
  select email, coalesce(subscription_plan, 'free')
    into v_secondary_email, v_secondary_plan
    from public.users where id = p_secondary;

  if v_primary_email is null or v_secondary_email is null then
    raise exception 'account not found';
  end if;
  -- 구독 유실 방지: secondary 가 Pro 인데 primary 가 free 면 거부 (이중 안전장치).
  if v_secondary_plan = 'pro' and v_primary_plan <> 'pro' then
    raise exception 'secondary is Pro but primary is not — choose Pro account as primary';
  end if;
  if v_secondary_plan = 'pro' and v_primary_plan = 'pro' then
    v_both_pro := true;
  end if;

  -- ── 1. 충돌 선처리 ─────────────────────────────────────────────────────────
  -- (a) dedupe 정책: secondary 의 '겹치는'(동일 start_at + title) 일정을 먼저 삭제.
  if p_conflict_policy = 'dedupe' then
    delete from public.events se
    where se.user_id = p_secondary
      and exists (
        select 1 from public.events pe
        where pe.user_id = p_primary
          and pe.start_at = se.start_at
          and lower(btrim(pe.title)) = lower(btrim(se.title))
      );
    get diagnostics v_deduped = row_count;
  end if;

  -- (b) space_members UNIQUE(space_id, user_id): primary 가 이미 멤버인 스페이스의
  --     secondary 멤버 행을 삭제(중복 회피) 후 나머지를 이전.
  delete from public.space_members sm_sec
   where sm_sec.user_id = p_secondary
     and exists (
       select 1 from public.space_members sm_pri
        where sm_pri.user_id = p_primary
          and sm_pri.space_id = sm_sec.space_id
     );

  -- (c) event_reactions UNIQUE(event_id, user_id, emoji): primary 가 이미 같은
  --     (event, emoji) 로 반응한 secondary 행을 삭제 후 나머지를 이전.
  begin
    delete from public.event_reactions er_sec
     where er_sec.user_id = p_secondary
       and exists (
         select 1 from public.event_reactions er_pri
          where er_pri.user_id = p_primary
            and er_pri.event_id = er_sec.event_id
            and er_pri.emoji    = er_sec.emoji
       );
  exception when undefined_table then null; end;

  -- ── 2. 전수 이전 (denylist 제외 모든 user 참조 데이터) ──────────────────────
  --   각 UPDATE 는 환경별 스키마 차이를 견디기 위해 개별 예외로 감싼다. 빠뜨린 테이블이
  --   있어도 아래 §4 가드가 잡아내므로 조용한 소실은 발생하지 않는다.
  update public.space_members set user_id = p_primary where user_id = p_secondary;

  update public.events        set user_id = p_primary where user_id = p_secondary;
  get diagnostics v_moved_events = row_count;
  update public.todos         set user_id = p_primary where user_id = p_secondary;
  update public.categories    set user_id = p_primary where user_id = p_secondary;
  update public.ai_chat_logs  set user_id = p_primary where user_id = p_secondary;
  update public.usage_metrics set user_id = p_primary where user_id = p_secondary;
  update public.spaces        set created_by = p_primary where created_by = p_secondary;
  update public.anniversaries set created_by = p_primary where created_by = p_secondary;

  -- v2 에서 이미 이전하던 부가 테이블 (환경별 부재 가능 → 예외 무시).
  begin update public.ad_reward_logs         set user_id = p_primary where user_id = p_secondary; exception when undefined_table then null; end;
  begin update public.web_push_subscriptions set user_id = p_primary where user_id = p_secondary; exception when undefined_table then null; end;
  begin update public.todo_attachments       set user_id = p_primary where user_id = p_secondary; exception when undefined_table then null; end;
  begin update public.weekly_reviews         set user_id = p_primary where user_id = p_secondary; exception when undefined_table then null; end;
  begin update public.reactivation_pushes    set user_id = p_primary where user_id = p_secondary; exception when undefined_table then null; end;
  begin
    update public.notifications_queue set recipient_user_id = p_primary where recipient_user_id = p_secondary;
    update public.notifications_queue set actor_user_id     = p_primary where actor_user_id     = p_secondary;
  exception when undefined_table then null; end;

  -- v3 신규 — 그동안 소실되던 스페이스 채팅 / 일정 댓글·반응·리마인더.
  begin
    update public.space_messages set sender_id = p_primary where sender_id = p_secondary;
    get diagnostics v_moved_messages = row_count;
  exception when undefined_table then null; end;
  begin
    update public.event_comments set user_id = p_primary where user_id = p_secondary;
    get diagnostics v_moved_comments = row_count;
  exception when undefined_table then null; end;
  begin
    update public.event_reactions set user_id = p_primary where user_id = p_secondary;
    get diagnostics v_moved_reactions = row_count;
  exception when undefined_table then null; end;
  begin
    update public.event_reminders set user_id = p_primary where user_id = p_secondary;
    get diagnostics v_moved_reminders = row_count;
  exception when undefined_table then null; end;

  -- ── 3. 로그인 수단(identity) 귀속 — B 의 모든 auth.identities 를 primary 로 ──
  --   서로 다른 계정이라 (provider_id, provider) unique 충돌 없음. 이후 B 의 로그인
  --   방법으로 들어와도 primary 유저로 resolve → 동일 데이터.
  update auth.identities set user_id = p_primary where user_id = p_secondary;
  get diagnostics v_moved_idents = row_count;

  -- ── 4. 데이터 소실 가드 — public.users 삭제 직전 잔존 참조 검사 ──────────────
  --   public.users / auth.users 를 참조하는 FK 중 denylist 가 아니고 SET NULL 도 아닌
  --   테이블에 secondary 가 아직 남아 있으면, 삭제 시 CASCADE 로 소실된다는 뜻이므로
  --   통합을 중단(롤백)한다. 미래에 새 FK 테이블이 추가돼도 자동으로 탐지된다.
  for rec in
    select distinct
      con.conrelid::regclass::text as tbl_qual,   -- 예: public.events / schema.tbl
      (con.conrelid::regclass)::text             as tbl_plain,
      att.attname                                as col
    from pg_constraint con
    join pg_attribute att
      on att.attrelid = con.conrelid and att.attnum = any(con.conkey)
    where con.contype = 'f'
      and con.connamespace = 'public'::regnamespace
      and con.confrelid in ('public.users'::regclass, 'auth.users'::regclass)
      and con.confdeltype <> 'n'   -- SET NULL 은 익명화일 뿐 소실 아님 → 제외
  loop
    -- regclass 텍스트는 'public.tbl' 또는 'tbl' 로 나올 수 있어 끝 토큰만 비교.
    if split_part(rec.tbl_qual, '.', -1) = any(v_denylist) then continue; end if;
    if split_part(rec.tbl_qual, '.', -1) = 'users' then continue; end if;  -- 자기 자신
    execute format(
      'select exists(select 1 from %s where %I = $1)', rec.tbl_qual, rec.col
    ) into v_exists using p_secondary;
    if v_exists then
      raise exception
        'merge_account_v3 aborted: secondary % still referenced by %.% — add it to the transfer list (data-loss guard)',
        p_secondary, rec.tbl_qual, rec.col;
    end if;
  end loop;

  -- ── 5. secondary 프로필 삭제 (auth.users 행 삭제는 Edge 의 admin API 가 담당) ──
  delete from public.users where id = p_secondary;

  return jsonb_build_object(
    'ok',              true,
    'primary',         p_primary,
    'secondary',       p_secondary,
    'moved_events',    v_moved_events,
    'moved_messages',  v_moved_messages,
    'moved_comments',  v_moved_comments,
    'moved_reactions', v_moved_reactions,
    'moved_reminders', v_moved_reminders,
    'moved_idents',    v_moved_idents,
    'deduped',         v_deduped,
    'policy',          p_conflict_policy,
    'both_pro',        v_both_pro
  );
end;
$$;

revoke all on function merge_account_v3(uuid, uuid, text) from public, anon, authenticated;
grant execute on function merge_account_v3(uuid, uuid, text) to service_role;

comment on function merge_account_v3(uuid, uuid, text) is
  '[service_role 전용] 계정 통합 v3 — 전수 이전(denylist) + 데이터 소실 가드. secondary 의 모든 user 참조 데이터(space_messages/event_comments/reactions/reminders 포함)를 primary 로 이전하고, 잔존 참조가 있으면 통합을 중단한다. 보안은 Edge account-merge-bytoken 의 양토큰 검증이 담당.';
