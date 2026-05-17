-- 033_storage_space_covers — avatars 버킷의 space-covers/ 경로 RLS 추가.
--
-- 문제: Space 커버 업로드 시 "new row violates row-level security policy"
-- avatars 버킷의 기존 정책은 사용자 자신의 폴더(`{user_id}/...`)만 허용.
-- Space 커버는 `space-covers/{space_id}/cover.{ext}` 경로라 owner 검증을
-- 다른 기준으로 통과시켜야 함.

-- READ: 모두 (avatars 버킷은 public read 이미 가능하지만 명시)
create policy "space_covers_read"
  on storage.objects for select
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = 'space-covers'
  );

-- INSERT: 해당 space 의 owner 만
create policy "space_covers_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = 'space-covers'
    and exists (
      select 1 from public.spaces
      where id::text = (storage.foldername(name))[2]
        and created_by = auth.uid()
    )
  );

-- UPDATE (upsert): owner 만
create policy "space_covers_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = 'space-covers'
    and exists (
      select 1 from public.spaces
      where id::text = (storage.foldername(name))[2]
        and created_by = auth.uid()
    )
  );

-- DELETE: owner 만 (Space 삭제 시 cleanup)
create policy "space_covers_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = 'space-covers'
    and exists (
      select 1 from public.spaces
      where id::text = (storage.foldername(name))[2]
        and created_by = auth.uid()
    )
  );
