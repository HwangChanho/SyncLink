-- 034_todo_attachments — 노트(Todo) 사진/음성 첨부 (최대 5개).
--
-- Plan: docs/plans/2026-05-14-note-attachments.md
-- Storage 버킷 `todo-attachments` 는 Supabase Dashboard 에서 별도 생성
-- (private, 10MB limit, image/* + audio/m4a/mp4).

create type public.todo_attachment_kind as enum ('photo', 'voice');

create table public.todo_attachments (
  id           uuid primary key default gen_random_uuid(),
  todo_id      uuid not null references public.todos(id) on delete cascade,
  user_id      uuid not null references public.users(id),
  kind         public.todo_attachment_kind not null,
  storage_path text not null,
  duration_ms  int,            -- voice only
  width        int,            -- photo only
  height       int,            -- photo only
  size_bytes   int,
  created_at   timestamptz not null default now()
);
create index todo_attachments_todo_id_idx on public.todo_attachments(todo_id);

alter table public.todo_attachments enable row level security;

-- READ: 본인 첨부만
create policy todo_attachments_select on public.todo_attachments for select
  using (user_id = auth.uid());

-- INSERT: 본인 todo 의 첨부만
create policy todo_attachments_insert on public.todo_attachments for insert
  with check (
    user_id = auth.uid()
    and todo_id in (select id from public.todos where user_id = auth.uid())
  );

-- DELETE: 본인 첨부만
create policy todo_attachments_delete on public.todo_attachments for delete
  using (user_id = auth.uid());

-- ── 5개 제한 트리거 ─────────────────────────────────────────────────────────
create or replace function public.enforce_todo_attachments_limit()
returns trigger language plpgsql as $$
begin
  if (select count(*) from public.todo_attachments where todo_id = new.todo_id) >= 5 then
    raise exception 'TODO_ATTACHMENTS_LIMIT' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger todo_attachments_limit_check
  before insert on public.todo_attachments
  for each row execute function public.enforce_todo_attachments_limit();

-- ── Storage bucket RLS (avatars 패턴과 동일) ───────────────────────────────
-- todo-attachments/{todo_id}/{filename}
-- todo_id 가 본인의 todo 일 때만 read/insert/delete 허용.
create policy "todo_attachments_storage_read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'todo-attachments'
    and exists (
      select 1 from public.todos
      where id::text = (storage.foldername(name))[1]
        and user_id = auth.uid()
    )
  );

create policy "todo_attachments_storage_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'todo-attachments'
    and exists (
      select 1 from public.todos
      where id::text = (storage.foldername(name))[1]
        and user_id = auth.uid()
    )
  );

create policy "todo_attachments_storage_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'todo-attachments'
    and exists (
      select 1 from public.todos
      where id::text = (storage.foldername(name))[1]
        and user_id = auth.uid()
    )
  );
