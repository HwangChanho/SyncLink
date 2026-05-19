/**
 * eventImageService — v1.1.2 일정 이미지 첨부 (최대 5장).
 *
 * 흐름:
 *  1) ImagePicker 로 선택한 로컬 URI → ImageManipulator 로 압축 (1024px, 0.8)
 *  2) Supabase Storage `event-images` bucket 에 `{userId}/{eventId}/{position}.jpg` 경로로 업로드
 *  3) public URL 을 event_images 테이블에 INSERT
 *  4) 일정 상세 / 편집 화면에서 url 로 표시
 *
 * RLS:
 *  - INSERT/DELETE: owner only (event.user_id = auth.uid)
 *  - SELECT: owner + event 공유받은 사용자
 *
 * 비용 가드:
 *  - 이미지당 max 5MB (bucket-level)
 *  - JPEG 압축 quality 0.8, max 1024px 변(긴 쪽 기준)
 *  - event 당 5장 제한 (클라이언트 가드 + position unique 제약)
 *
 * @see supabase/migrations (event_images table)
 */

import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { supabase, getCurrentUserId } from '@/lib/supabase';

/** 최대 첨부 개수 — UI 가드 + DB position unique 와 함께 작동. */
export const MAX_EVENT_IMAGES = 5;

/** Long-edge 픽셀 상한. 모바일 표시에 충분하면서 업로드 비용 절감. */
const MAX_DIMENSION = 1024;

/** JPEG 압축 품질 (0–1). 0.8 = 시각 손실 미미 + 파일 크기 ~25%. */
const JPEG_QUALITY = 0.8;

export interface EventImage {
  id:        string;
  eventId:   string;
  url:       string;
  position:  number;
  createdAt: Date;
}

interface EventImageRow {
  id:         string;
  event_id:   string;
  url:        string;
  position:   number;
  created_at: string;
}

/** Row → 도메인 변환. */
function toEventImage(row: EventImageRow): EventImage {
  return {
    id:        row.id,
    eventId:   row.event_id,
    url:       row.url,
    position:  row.position,
    createdAt: new Date(row.created_at),
  };
}

/**
 * 특정 event 의 이미지 목록을 position 오름차순으로 조회.
 */
export async function listEventImages(eventId: string): Promise<EventImage[]> {
  const { data, error } = await supabase
    .from('event_images')
    .select('id, event_id, url, position, created_at')
    .eq('event_id', eventId)
    .order('position', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => toEventImage(r as EventImageRow));
}

/**
 * 로컬 ImagePicker URI 를 압축 후 Storage 에 업로드하고 event_images row 를 추가.
 *
 * @param eventId      대상 event id (이미 INSERT 된 row 의 id)
 * @param localUri     ImagePicker.assets[i].uri
 * @param position     0–4 (max 5장)
 * @returns 신규 EventImage row
 */
export async function uploadEventImage(
  eventId: string,
  localUri: string,
  position: number,
): Promise<EventImage> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('User is not authenticated.');
  if (position < 0 || position >= MAX_EVENT_IMAGES) {
    throw new Error(`position 은 0..${MAX_EVENT_IMAGES - 1} 범위여야 합니다.`);
  }

  // 1) 압축 — long-edge MAX_DIMENSION. manipulateAsync 옛 API 사용
  //    (v13 builder API 호환성 이슈로 release build 에서 fail 가능).
  const manipulated = await manipulateAsync(
    localUri,
    [{ resize: { width: MAX_DIMENSION } }],
    { compress: JPEG_QUALITY, format: SaveFormat.JPEG },
  );

  // 2) URI → ArrayBuffer (React Native fetch → blob → arrayBuffer).
  //    Supabase JS SDK 는 RN 환경에서 ArrayBuffer 권장.
  const response = await fetch(manipulated.uri);
  const arrayBuffer = await response.arrayBuffer();

  // 3) Storage path = userId/eventId/position.jpg.
  //    RLS 가 (foldername)[1] === auth.uid()::text 를 강제하므로 이 구조 필수.
  const path = `${userId}/${eventId}/${position}.jpg`;

  const { error: uploadError } = await supabase
    .storage
    .from('event-images')
    .upload(path, arrayBuffer, {
      contentType: 'image/jpeg',
      upsert:      true,  // 같은 position 재업로드 허용 (수정 시 덮어쓰기)
    });
  if (uploadError) throw uploadError;

  // 4) public URL 조회 후 row INSERT (또는 upsert).
  const { data: publicUrlData } = supabase
    .storage
    .from('event-images')
    .getPublicUrl(path);
  const publicUrl = publicUrlData.publicUrl;

  // event_images 는 (event_id, position) unique. 같은 position 이 이미
  // 있으면 url 갱신, 없으면 신규 insert. onConflict 로 upsert.
  const { data, error } = await supabase
    .from('event_images')
    .upsert(
      { event_id: eventId, url: publicUrl, position },
      { onConflict: 'event_id,position' },
    )
    .select()
    .single();
  if (error || !data) throw error ?? new Error('이미지 등록에 실패했습니다.');

  return toEventImage(data as EventImageRow);
}

/**
 * 이미지 1장 삭제 — DB row + Storage 객체 모두 제거.
 */
export async function deleteEventImage(image: EventImage): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('User is not authenticated.');

  // Storage 객체 경로는 url 에서 역추출하지 않고 컨벤션대로 재구성.
  const path = `${userId}/${image.eventId}/${image.position}.jpg`;

  const { error: storageError } = await supabase
    .storage
    .from('event-images')
    .remove([path]);
  // Storage 삭제 실패는 무시 (이미 없을 수 있음). DB row 삭제는 진행.

  const { error: dbError } = await supabase
    .from('event_images')
    .delete()
    .eq('id', image.id);
  if (dbError) throw dbError;
  if (storageError) {
    // 로그만 남기고 무시 — DB 가 truth-of-source.
    console.warn('[eventImageService] storage delete failed (non-fatal):', storageError);
  }
}

/**
 * 한 event 의 모든 이미지 삭제. event 삭제 시 ON DELETE CASCADE 로
 * event_images row 는 자동 삭제되지만, Storage 객체는 별도 정리 필요.
 */
export async function deleteAllEventImages(eventId: string): Promise<void> {
  const images = await listEventImages(eventId);
  for (const img of images) {
    await deleteEventImage(img);
  }
}
