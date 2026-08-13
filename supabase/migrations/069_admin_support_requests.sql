-- 069_admin_support_requests.sql
--
-- 관리자 페이지에서 버그 제보 / 문의를 조회·처리 상태 변경.
--
-- 배경: 067 은 제보를 저장하고 **관리자 메일**로 알렸다. LEAD 결정(2026-08-13)으로
-- 메일을 빼고 **관리자 페이지에서 보는 방식**으로 바꾼다.
--   · 메일은 Resend 무료 티어의 일일 한도에 걸릴 수 있고, 스팸함으로 새기도 한다
--   · 어차피 관리자 페이지가 있으니 한 곳에서 보는 편이 낫다
-- ⚠️ 대신 **푸시가 사라진다** — 새 제보를 알아서 알려주지 않으므로 주기적으로 봐야 한다.
--    미확인 건수를 화면 상단에 크게 띄워 그 위험을 줄인다.
--
-- 관리자 인증은 supabase auth 와 분리된 자체 세션(047·050)을 쓴다.
-- 모든 RPC 가 `admin_validate_session(p_token)` 으로 검증하는 기존 패턴을 그대로 따른다.

-- 처리 상태. 제보가 쌓이면 "본 것/안 본 것"을 가려야 한다.
alter table public.support_requests
  add column if not exists status text not null default 'open'
    check (status in ('open', 'in_progress', 'resolved', 'ignored'));

-- 관리자 메모. 답변 내용이나 처리 경위를 남긴다.
alter table public.support_requests
  add column if not exists admin_note text;

create index if not exists support_requests_status_idx
  on public.support_requests (status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 목록 조회
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_get_support_requests(
  p_token  text,
  p_status text default null,   -- null = 전체
  p_limit  integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user  text;
  v_items jsonb;
  v_counts jsonb;
begin
  v_user := admin_validate_session(p_token);
  if v_user is null then
    raise exception 'invalid or expired session';
  end if;

  -- 상태별 건수 — 화면 상단 배지. 필터와 무관하게 항상 전체 기준으로 센다.
  select jsonb_build_object(
           'total',       count(*),
           'open',        count(*) filter (where status = 'open'),
           'in_progress', count(*) filter (where status = 'in_progress'),
           'resolved',    count(*) filter (where status = 'resolved'),
           'ignored',     count(*) filter (where status = 'ignored'),
           'bug',         count(*) filter (where kind = 'bug'),
           'inquiry',     count(*) filter (where kind = 'inquiry')
         )
    into v_counts
    from support_requests;

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    into v_items
    from (
      select
        sr.id,
        sr.kind,
        sr.message,
        sr.reply_email,
        sr.status,
        sr.admin_note,
        sr.created_at,
        sr.diagnostics,
        -- 닉네임은 진단 정보에 이미 담겨 있지만, 계정이 그 뒤 바뀌었을 수 있어
        -- 현재 값을 함께 준다. 둘이 다르면 제보 후 변경된 것이다.
        u.nickname as current_nickname
      from support_requests sr
      left join users u on u.id = sr.user_id
      where p_status is null or sr.status = p_status
      order by
        -- 미확인(open)을 항상 위로. 그다음 최신순.
        case when sr.status = 'open' then 0 else 1 end,
        sr.created_at desc
      limit greatest(1, least(p_limit, 200))
      offset greatest(0, p_offset)
    ) t;

  return jsonb_build_object('counts', v_counts, 'items', v_items);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 상태 / 메모 갱신
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_update_support_request(
  p_token  text,
  p_id     uuid,
  p_status text default null,
  p_note   text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user text;
  v_row  support_requests;
begin
  v_user := admin_validate_session(p_token);
  if v_user is null then
    raise exception 'invalid or expired session';
  end if;

  if p_status is not null and p_status not in ('open','in_progress','resolved','ignored') then
    raise exception 'invalid status: %', p_status;
  end if;

  -- null 인 인자는 건드리지 않는다 — 상태만 바꾸거나 메모만 다는 호출을 각각 지원한다.
  update support_requests
     set status     = coalesce(p_status, status),
         admin_note = coalesce(p_note, admin_note)
   where id = p_id
   returning * into v_row;

  if v_row.id is null then
    raise exception 'support request not found: %', p_id;
  end if;

  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'admin_note', v_row.admin_note);
end;
$$;

-- 🔴 RLS 는 067 그대로 읽기 정책 없음을 유지한다. 이 함수들은 security definer 라
--    RLS 를 우회하며, 접근 통제는 admin_validate_session 이 전담한다.
revoke all on function public.admin_get_support_requests(text, text, integer, integer) from public, anon;
revoke all on function public.admin_update_support_request(text, uuid, text, text) from public, anon;
grant execute on function public.admin_get_support_requests(text, text, integer, integer) to anon, authenticated;
grant execute on function public.admin_update_support_request(text, uuid, text, text) to anon, authenticated;

comment on function public.admin_get_support_requests is
  '관리자: 버그 제보/문의 목록 + 상태별 건수. open 을 위로 정렬.';
