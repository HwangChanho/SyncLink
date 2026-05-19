-- v1.2.0 — Space 멤버 간 실시간 메신저 (Phase 3).
--
-- space_messages 테이블 + RLS + Realtime publication + Storage bucket +
-- push notification trigger (notifications_queue 재사용).
--
-- 의존성:
--   021_space_activity_notifications.sql — notifications_queue / dispatch infra
--   038_cron_use_vault.sql — vault.decrypted_secrets (dispatch cron 호출)

-- ─── 1. space_messages 테이블 ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.space_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id   uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  sender_id  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body       text,
  image_url  text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- body 또는 image_url 중 하나는 있어야 함 (빈 메시지 방지).
  CHECK (body IS NOT NULL OR image_url IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS space_messages_space_idx
  ON public.space_messages (space_id, created_at DESC);

ALTER TABLE public.space_messages ENABLE ROW LEVEL SECURITY;

-- READ: Space 멤버만.
DROP POLICY IF EXISTS space_messages_select ON public.space_messages;
CREATE POLICY space_messages_select ON public.space_messages FOR SELECT
  USING (space_id IN (SELECT space_id FROM public.space_members WHERE user_id = auth.uid()));

-- INSERT: 자기 자신 sender + 자기가 멤버인 Space 만.
DROP POLICY IF EXISTS space_messages_insert ON public.space_messages;
CREATE POLICY space_messages_insert ON public.space_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND space_id IN (SELECT space_id FROM public.space_members WHERE user_id = auth.uid())
  );

-- DELETE: 자기 메시지만.
DROP POLICY IF EXISTS space_messages_delete ON public.space_messages;
CREATE POLICY space_messages_delete ON public.space_messages FOR DELETE
  USING (sender_id = auth.uid());

-- ─── 2. Realtime publication ──────────────────────────────────────────────
-- 동일 publication 반복 추가는 에러 → DO 블록으로 검사.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'space_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.space_messages;
  END IF;
END $$;

-- ─── 3. Storage bucket space-images ───────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'space-images', 'space-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS space_images_upload ON storage.objects;
CREATE POLICY space_images_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'space-images' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS space_images_read ON storage.objects;
CREATE POLICY space_images_read ON storage.objects FOR SELECT
  USING (bucket_id = 'space-images');

DROP POLICY IF EXISTS space_images_delete ON storage.objects;
CREATE POLICY space_images_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'space-images' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ─── 4. notifications_queue.type 에 'message_received' 추가 ──────────────
ALTER TABLE public.notifications_queue
  DROP CONSTRAINT IF EXISTS notifications_queue_type_check;
ALTER TABLE public.notifications_queue
  ADD CONSTRAINT notifications_queue_type_check
  CHECK (type IN ('event_added', 'event_updated', 'event_deleted', 'message_received'));

-- ─── 5. INSERT trigger → push notification enqueue ────────────────────────
CREATE OR REPLACE FUNCTION public.trg_space_messages_inserted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_nick text;
  v_space_name  text;
  v_preview     text;
BEGIN
  SELECT nickname INTO v_sender_nick FROM public.users  WHERE id = NEW.sender_id;
  SELECT name     INTO v_space_name  FROM public.spaces WHERE id = NEW.space_id;
  v_preview := COALESCE(
    NULLIF(LEFT(NEW.body, 80), ''),
    CASE WHEN NEW.image_url IS NOT NULL THEN '사진' ELSE '' END
  );

  INSERT INTO public.notifications_queue (
    space_id, recipient_user_id, actor_user_id, event_id, type, payload
  )
  SELECT
    NEW.space_id,
    sm.user_id,
    NEW.sender_id,
    NULL,
    'message_received',
    jsonb_build_object(
      'space_name',     COALESCE(v_space_name, '스페이스'),
      'actor_nickname', COALESCE(v_sender_nick, '멤버'),
      'preview',        v_preview
    )
  FROM public.space_members sm
  JOIN public.users u ON u.id = sm.user_id
  WHERE sm.space_id = NEW.space_id
    AND sm.user_id <> NEW.sender_id
    AND u.push_token IS NOT NULL
    AND COALESCE(u.push_enabled, true) = true;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS space_messages_after_insert_notify ON public.space_messages;
CREATE TRIGGER space_messages_after_insert_notify
  AFTER INSERT ON public.space_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_space_messages_inserted();

-- ─── 6. dispatch-notifications cron (vault 기반) ──────────────────────────
-- 021 의 기존 cron 은 current_setting('app.*') 기반이라 Supabase managed
-- Postgres 에서 작동하지 않았음 (ALTER DATABASE SET 권한 거부). 038 패턴으로
-- vault.decrypted_secrets 의 supabase_url + dispatch_secret 사용.
--
-- secret 사전 등록 필요 (한 번):
--   SELECT vault.create_secret('https://<project>.supabase.co', 'supabase_url');
--   SELECT vault.create_secret('<random hex>',                 'dispatch_secret');
-- 그리고 Edge Function 환경 변수에 DISPATCH_SECRET 동일 값 등록.

SELECT cron.unschedule('space-activity-dispatch')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'space-activity-dispatch');

SELECT cron.schedule(
  'space-activity-dispatch',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url')
           || '/functions/v1/dispatch-notifications',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dispatch_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
