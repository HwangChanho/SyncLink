-- ============================================================================
-- 078 — 일정·대화 사진 열람 정책: «그 일정·메시지를 볼 수 있는 사람»만 (2026-10-13)
--
-- 배경: 077 에서 event-images·space-images 의 SELECT 를 «본인 폴더만»으로 좁혔다.
--   지금 사진 표시는 공개 URL 이라 RLS 와 무관하지만, 앱(3-B)은 표시를 서명 URL(createSignedUrl)로 옮긴다.
--   서명 URL 발급에는 그 파일의 SELECT 권한이 필요하다 → 공유받은 일정·같은 Space 대화의 사진을 볼 수 있게 한다.
--   (버킷 비공개 전환은 옛 앱이 빠진 뒤 3-C 에서. 이 파일은 권한을 «볼 수 있는 사람»까지만 연다)
--
-- 판정은 일정·메시지 테이블의 기존 SELECT 정책을 그대로 따른다
--   (정책 안 서브쿼리도 호출자 권한으로 실행되므로 events·space_messages RLS 가 적용된다).
-- 경로 규칙(앱 업로드 코드와 같다):
--   event-images/<작성자 id>/<일정 id>/<순번>.jpg         — eventImageService.uploadEventImage
--   space-images/<보낸 사람 id>/messages/<메시지 id>.jpg   — spaceMessageService.sendImageMessage
-- 경로 첫 폴더가 그 일정·메시지의 작성자와 같아야 한다 — 다른 사람 폴더의 파일이 남의 일정에 묶이지 않게.
--
-- 되돌리기: 파일 맨 아래 주석.
-- ============================================================================

-- ── 일정 사진: 그 일정을 볼 수 있으면 읽기 ─────────────────────────────────────
-- uuid 로 바꾸지 않고 문자열로 비교한다 — 경로가 uuid 모양이 아니어도 오류 없이 «해당 없음»이 된다.
drop policy if exists event_images_read_viewer on storage.objects;
create policy event_images_read_viewer on storage.objects
  for select to authenticated
  using (
    bucket_id = 'event-images'
    and exists (
      select 1 from public.events e
      where e.id::text      = (storage.foldername(objects.name))[2]
        and e.user_id::text = (storage.foldername(objects.name))[1]
    )
  );

-- ── 대화 사진: 그 메시지를 볼 수 있으면(같은 Space 멤버) 읽기 ──────────────────
-- 파일 이름(확장자 앞)이 메시지 id 다.
drop policy if exists space_images_read_viewer on storage.objects;
create policy space_images_read_viewer on storage.objects
  for select to authenticated
  using (
    bucket_id = 'space-images'
    and (storage.foldername(objects.name))[2] = 'messages'
    and exists (
      select 1 from public.space_messages m
      where m.id::text        = split_part(storage.filename(objects.name), '.', 1)
        and m.sender_id::text = (storage.foldername(objects.name))[1]
    )
  );

-- ============================================================================
-- 되돌리기 (필요 시 수동 실행)
-- drop policy if exists event_images_read_viewer on storage.objects;
-- drop policy if exists space_images_read_viewer on storage.objects;
-- ============================================================================
