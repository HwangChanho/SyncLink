-- v1.1.2 — 일정 이미지 첨부 (max 5장 / event).
--
-- 압축은 클라이언트(expo-image-manipulator) 에서 1024px / JPEG 0.8.
-- Storage bucket 'event-images' + DB row 1:1 매핑.

CREATE TABLE IF NOT EXISTS public.event_images (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  url        text NOT NULL,
  position   int  NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, position)
);

CREATE INDEX IF NOT EXISTS event_images_event_idx
  ON public.event_images (event_id, position);

ALTER TABLE public.event_images ENABLE ROW LEVEL SECURITY;

-- READ: owner + event 공유 받은 사람.
DROP POLICY IF EXISTS event_images_select ON public.event_images;
CREATE POLICY event_images_select ON public.event_images FOR SELECT
  USING (
    event_id IN (SELECT id FROM public.events WHERE user_id = auth.uid())
    OR event_id IN (
      SELECT es.event_id FROM public.event_shares es
      JOIN public.space_members sm ON sm.space_id = es.space_id
      WHERE sm.user_id = auth.uid()
    )
  );

-- INSERT / DELETE: owner only.
DROP POLICY IF EXISTS event_images_insert ON public.event_images;
CREATE POLICY event_images_insert ON public.event_images FOR INSERT
  WITH CHECK (event_id IN (SELECT id FROM public.events WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS event_images_delete ON public.event_images;
CREATE POLICY event_images_delete ON public.event_images FOR DELETE
  USING (event_id IN (SELECT id FROM public.events WHERE user_id = auth.uid()));

-- ─── Storage bucket + 정책 ───────────────────────────────────────────────
-- public read (이미지 url 노출 OK), authenticated 만 write/delete,
-- path 컨벤션: {userId}/{eventId}/{position}.jpg.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'event-images', 'event-images',
  true,
  5242880,  -- 5MB / image
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS event_images_upload ON storage.objects;
CREATE POLICY event_images_upload ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (
    bucket_id = 'event-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS event_images_read ON storage.objects;
CREATE POLICY event_images_read ON storage.objects FOR SELECT
  USING (bucket_id = 'event-images');

DROP POLICY IF EXISTS event_images_delete ON storage.objects;
CREATE POLICY event_images_delete ON storage.objects FOR DELETE
  TO authenticated USING (
    bucket_id = 'event-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
