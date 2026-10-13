-- ============================================================================
-- 077 — 저장소 정책 범위 정리 + 초대 가입 RPC + 공동 멤버 프로필 뷰 (2026-10-13)
--
-- 앱 변경 없이 적용해도 옛 앱이 그대로 동작하는 것만 담는다.
--   1. Space 표지(avatars/space-covers/<spaceId>/…) 정책 4개를 «파일 경로의 spaceId 의 현재 owner» 기준으로 고친다.
--      기존 정책은 서브쿼리 안의 name 이 public.spaces.name 으로 해석돼 파일과 무관하게 판정했다
--      → 정상적인 표지 업로드가 막혀 있었다(표지 있는 Space 0개).
--   2. 공개 버킷(avatars·event-images·space-images)의 SELECT 정책을 «본인 폴더만»으로 좁힌다.
--      공개 URL(/storage/v1/object/public/…)은 RLS 를 거치지 않으므로 앱의 사진 표시는 그대로다.
--      좁혀지는 것은 API 를 통한 목록 조회·다운로드뿐이다(앱은 쓰지 않는다 — 덮어쓰기 업로드용 본인 파일 SELECT 는 유지).
--      event-images 는 덮어쓰기(upsert) 업로드를 쓰는데 UPDATE 정책이 없어 재업로드가 실패했다 → 본인 폴더 UPDATE 추가.
--   3. 초대 RPC 2개 — 앱(3-B)이 전환할 새 경로. 옛 RPC(find_space_by_invite_code)와 옛 직접 INSERT 경로는 그대로 둔다.
--      - preview_space_by_invite_code: 초대 링크 미리보기에 필요한 값(이름·종류·인원·표지)만 준다.
--        (지금 링크 미리보기는 spaces 를 직접 읽어 비멤버에게 늘 0행 → «유효하지 않은 초대 코드»)
--      - join_space_by_invite_code: 만료·사용 한도·커플 2명·이미 멤버를 서버에서 검사하고 가입 + 사용 횟수 +1.
--   4. member_profiles 뷰 — 공동 멤버에게 보여 줄 열(id·nickname·avatar_url)만. 앱(3-B)이 남의 users 행 대신 이걸 읽는다.
--
-- 되돌리기: 파일 맨 아래 주석.
-- ============================================================================


-- ── 1. Space 표지 정책 ───────────────────────────────────────────────────────
-- 판정 기준 = 경로 두 번째 폴더(spaceId)의 현재 owner(space_members.role='owner').
-- 앱의 uploadSpaceCover 가 쓰는 assertOwner 와 같은 기준이다(owner 위임 후에도 새 owner 가 바꿀 수 있다).
-- objects.name 을 명시해 서브쿼리 테이블의 같은 이름 열로 해석되지 않게 한다.

drop policy if exists space_covers_read   on storage.objects;
drop policy if exists space_covers_insert on storage.objects;
drop policy if exists space_covers_update on storage.objects;
drop policy if exists space_covers_delete on storage.objects;

-- SELECT 는 덮어쓰기(upsert: true) 업로드에 필요하다. 표시용 공개 URL 은 이 정책과 무관하다.
create policy space_covers_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(objects.name))[1] = 'space-covers'
    and exists (
      select 1 from public.space_members m
      where m.space_id::text = (storage.foldername(objects.name))[2]
        and m.user_id = auth.uid()
        and m.role = 'owner'
    )
  );

create policy space_covers_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(objects.name))[1] = 'space-covers'
    and exists (
      select 1 from public.space_members m
      where m.space_id::text = (storage.foldername(objects.name))[2]
        and m.user_id = auth.uid()
        and m.role = 'owner'
    )
  );

create policy space_covers_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(objects.name))[1] = 'space-covers'
    and exists (
      select 1 from public.space_members m
      where m.space_id::text = (storage.foldername(objects.name))[2]
        and m.user_id = auth.uid()
        and m.role = 'owner'
    )
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(objects.name))[1] = 'space-covers'
    and exists (
      select 1 from public.space_members m
      where m.space_id::text = (storage.foldername(objects.name))[2]
        and m.user_id = auth.uid()
        and m.role = 'owner'
    )
  );

create policy space_covers_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(objects.name))[1] = 'space-covers'
    and exists (
      select 1 from public.space_members m
      where m.space_id::text = (storage.foldername(objects.name))[2]
        and m.user_id = auth.uid()
        and m.role = 'owner'
    )
  );


-- ── 2. 공개 버킷 SELECT 를 본인 폴더로 ───────────────────────────────────────
-- 경로 규칙: avatars/<userId>/… · event-images/<userId>/… · space-images/<userId>/… (각 업로드 정책과 같은 규칙)

drop policy if exists avatars_select_public on storage.objects;
create policy avatars_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(objects.name))[1] = auth.uid()::text);

drop policy if exists event_images_read on storage.objects;
create policy event_images_read_own on storage.objects
  for select to authenticated
  using (bucket_id = 'event-images' and (storage.foldername(objects.name))[1] = auth.uid()::text);

-- event-images 덮어쓰기 업로드(eventImageService upsert: true)에 필요한 UPDATE — 본인 폴더만.
drop policy if exists event_images_update_own on storage.objects;
create policy event_images_update_own on storage.objects
  for update to authenticated
  using      (bucket_id = 'event-images' and (storage.foldername(objects.name))[1] = auth.uid()::text)
  with check (bucket_id = 'event-images' and (storage.foldername(objects.name))[1] = auth.uid()::text);

drop policy if exists space_images_read on storage.objects;
create policy space_images_read_own on storage.objects
  for select to authenticated
  using (bucket_id = 'space-images' and (storage.foldername(objects.name))[1] = auth.uid()::text);


-- ── 3. 초대 RPC ──────────────────────────────────────────────────────────────

/**
 * 초대 링크 미리보기 — 코드에 해당하는 Space 의 공개해도 되는 값만 돌려준다.
 *
 * @param p_code 초대 코드(대소문자·앞뒤 공백 무시)
 * @returns 0행(없는 코드) 또는 1행: id·name·type·member_count·cover_image_url
 * 주의: 로그인 사용자만. 초대 코드·만료·사용 한도 같은 관리 값은 주지 않는다
 *       (만료·한도 판정은 join_space_by_invite_code 가 가입 시점에 한다).
 */
create or replace function public.preview_space_by_invite_code(p_code text)
returns table (id uuid, name text, type text, member_count integer, cover_image_url text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  return query
    select s.id,
           s.name,
           s.type::text,
           (select count(*)::integer from public.space_members m where m.space_id = s.id),
           s.cover_image_url
    from public.spaces s
    where s.invite_code = upper(btrim(p_code))
    limit 1;
end;
$$;

/**
 * 초대 코드로 Space 가입 — 검사·가입·사용 횟수 증가를 한 트랜잭션에서 한다.
 *
 * @param p_code  초대 코드(대소문자·앞뒤 공백 무시)
 * @param p_color 내 멤버 색(#RRGGBB). 앱이 미리보기 인원수로 getMemberColor 를 계산해 넘긴다
 *                (팔레트 계산을 앱 한 곳에만 두기 위해). 형식은 space_members.color_hex_format 이 검사한다.
 * @returns 가입한 Space id
 * @throws  errcode P0001 + 메시지 키 — 앱이 문구로 바꾼다:
 *          invite_invalid · invite_expired · invite_max_uses · already_member · couple_space_full
 * 주의: Space 행을 FOR UPDATE 로 잠가 동시 가입이 사용 한도·커플 제한을 함께 넘지 못하게 한다.
 *       role 은 항상 member. SECURITY DEFINER 라 space_members_guard_changes 트리거 검사는 통과한다
 *       (그 트리거는 클라이언트 직접 쓰기만 본다) — 그래서 검사를 이 함수 안에서 모두 한다.
 */
create or replace function public.join_space_by_invite_code(p_code text, p_color text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_space public.spaces%rowtype;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- 1) 코드로 Space 를 찾고 잠근다.
  select * into v_space
  from public.spaces
  where invite_code = upper(btrim(p_code))
  for update;
  if not found then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;

  -- 2) 만료·사용 한도.
  if v_space.invite_code_expires_at is not null and v_space.invite_code_expires_at < now() then
    raise exception 'invite_expired' using errcode = 'P0001';
  end if;
  if v_space.invite_code_max_uses is not null
     and coalesce(v_space.invite_code_uses_count, 0) >= v_space.invite_code_max_uses then
    raise exception 'invite_max_uses' using errcode = 'P0001';
  end if;

  -- 3) 이미 멤버 · 커플 2명.
  if exists (select 1 from public.space_members where space_id = v_space.id and user_id = v_uid) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;
  select count(*) into v_count from public.space_members where space_id = v_space.id;
  if v_space.type::text = 'couple' and v_count >= 2 then
    raise exception 'couple_space_full' using errcode = 'P0001';
  end if;

  -- 4) 가입(role 은 항상 member) + 사용 횟수 +1.
  insert into public.space_members (space_id, user_id, role, color)
  values (v_space.id, v_uid, 'member', p_color);

  update public.spaces
  set invite_code_uses_count = coalesce(invite_code_uses_count, 0) + 1
  where id = v_space.id;

  return v_space.id;
end;
$$;

revoke all on function public.preview_space_by_invite_code(text)    from public, anon;
revoke all on function public.join_space_by_invite_code(text, text) from public, anon;
grant execute on function public.preview_space_by_invite_code(text)    to authenticated;
grant execute on function public.join_space_by_invite_code(text, text) to authenticated;


-- ── 4. 공동 멤버 프로필 뷰 ──────────────────────────────────────────────────
-- 화면에 쓰는 열만(id·nickname·avatar_url). 본인 + 같은 Space 멤버만 보인다.
-- security_invoker = false(소유자 권한)로 users 의 RLS 대신 아래 WHERE 가 범위를 정한다 — 일부러다.
-- 그래서 범위 조건을 바꿀 때는 users_select_space_members 정책과 같은 범위를 유지할 것.
-- SELECT 만 부여하므로 (자동 갱신 가능한 뷰라도) 이 뷰로 쓰기는 안 된다.
create or replace view public.member_profiles
with (security_invoker = false)
as
  select u.id, u.nickname, u.avatar_url
  from public.users u
  where u.id = auth.uid()
     or u.id in (select g.user_id from public.get_space_member_ids(auth.uid()) as g(user_id));

revoke all on public.member_profiles from public, anon, authenticated;
grant select on public.member_profiles to authenticated;


-- ============================================================================
-- 되돌리기 (필요할 때만 수동 실행)
-- ----------------------------------------------------------------------------
-- drop view if exists public.member_profiles;
-- drop function if exists public.join_space_by_invite_code(text, text);
-- drop function if exists public.preview_space_by_invite_code(text);
--
-- drop policy if exists avatars_select_own      on storage.objects;
-- drop policy if exists event_images_read_own   on storage.objects;
-- drop policy if exists event_images_update_own on storage.objects;
-- drop policy if exists space_images_read_own   on storage.objects;
-- create policy avatars_select_public on storage.objects for select to anon, authenticated using (bucket_id = 'avatars');
-- create policy event_images_read     on storage.objects for select using (bucket_id = 'event-images');
-- create policy space_images_read     on storage.objects for select using (bucket_id = 'space-images');
--
-- 표지 정책 4개는 033_storage_space_covers.sql 의 원래 정의로 다시 만든다(drop 후 그 파일의 create policy 4개).
-- ============================================================================
