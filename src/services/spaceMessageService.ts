/**
 * spaceMessageService — v1.2.0 Space 멤버 간 메신저.
 *
 * DB: public.space_messages (id, space_id, sender_id, body, image_url, created_at).
 * Storage: space-images bucket (path: {userId}/messages/{messageId}.jpg).
 * Realtime: publication 등록됨, channel 'space-messages:{space_id}' 권장.
 *
 * 흐름:
 *  - list(space_id, limit?) → 최근 메시지 N 개 (newest first)
 *  - sendText(space_id, body) → INSERT 후 row 반환
 *  - sendImage(space_id, localUri) → 압축 + Storage 업로드 + INSERT
 *  - delete(message_id) → owner 만 (RLS 가 검증)
 *
 * Realtime: subscribeToSpace(space_id, onNew, onDelete) → cleanup 콜백 반환.
 */

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { supabase, getCurrentUserId } from '@/lib/supabase';

export interface SpaceMessage {
  id:        string;
  spaceId:   string;
  senderId:  string;
  body:      string | null;
  imageUrl:  string | null;
  createdAt: Date;
}

interface SpaceMessageRow {
  id:         string;
  space_id:   string;
  sender_id:  string;
  body:       string | null;
  image_url:  string | null;
  created_at: string;
}

function toMessage(row: SpaceMessageRow): SpaceMessage {
  return {
    id:        row.id,
    spaceId:   row.space_id,
    senderId:  row.sender_id,
    body:      row.body,
    imageUrl:  row.image_url,
    createdAt: new Date(row.created_at),
  };
}

/** 최근 메시지 목록 (newest first). 메시지 화면은 inverted FlatList 권장. */
export async function listMessages(spaceId: string, limit: number = 50): Promise<SpaceMessage[]> {
  const { data, error } = await supabase
    .from('space_messages')
    .select('id, space_id, sender_id, body, image_url, created_at')
    .eq('space_id', spaceId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => toMessage(r as SpaceMessageRow));
}

/** 텍스트 메시지 전송. */
export async function sendTextMessage(spaceId: string, body: string): Promise<SpaceMessage> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('User is not authenticated.');
  const trimmed = body.trim();
  if (!trimmed) throw new Error('빈 메시지는 보낼 수 없습니다.');

  const { data, error } = await supabase
    .from('space_messages')
    .insert({ space_id: spaceId, sender_id: userId, body: trimmed })
    .select()
    .single();
  if (error || !data) throw error ?? new Error('메시지 전송 실패');
  return toMessage(data as SpaceMessageRow);
}

/** 이미지 메시지 — 압축 후 Storage 업로드 + row INSERT. */
export async function sendImageMessage(spaceId: string, localUri: string): Promise<SpaceMessage> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('User is not authenticated.');

  // 압축
  const ctx = ImageManipulator.manipulate(localUri);
  ctx.resize({ width: 1024 });
  const rendered = await ctx.renderAsync();
  const manipulated = await rendered.saveAsync({
    compress: 0.8,
    format:   SaveFormat.JPEG,
  });

  // 임시 메시지 id 미리 생성 — Storage path 에 사용 (DB INSERT 후 RETURNING 받기 전).
  const msgId = crypto.randomUUID();
  const path = `${userId}/messages/${msgId}.jpg`;

  const response = await fetch(manipulated.uri);
  const buf = await response.arrayBuffer();
  const { error: upErr } = await supabase
    .storage.from('space-images')
    .upload(path, buf, { contentType: 'image/jpeg', upsert: false });
  if (upErr) throw upErr;

  const { data: pub } = supabase.storage.from('space-images').getPublicUrl(path);
  const imageUrl = pub.publicUrl;

  const { data, error } = await supabase
    .from('space_messages')
    .insert({ id: msgId, space_id: spaceId, sender_id: userId, image_url: imageUrl })
    .select()
    .single();
  if (error || !data) throw error ?? new Error('이미지 메시지 INSERT 실패');
  return toMessage(data as SpaceMessageRow);
}

/** 메시지 삭제 (자기 것만; RLS 가 검증). */
export async function deleteMessage(messageId: string): Promise<void> {
  const { error } = await supabase
    .from('space_messages')
    .delete()
    .eq('id', messageId);
  if (error) throw error;
}

/**
 * Realtime 구독. 새 메시지 INSERT / DELETE 이벤트 콜백 받음.
 * 반환된 함수 호출하면 unsubscribe.
 */
export function subscribeToSpace(
  spaceId: string,
  onInsert: (msg: SpaceMessage) => void,
  onDelete?: (id: string) => void,
): () => void {
  // 채널명 unique suffix — Sentry 크래시 fix 패턴 (postgres_changes 중복 채널 방지).
  const channelName = `space-messages:${spaceId}:${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes' as any,
      { event: 'INSERT', schema: 'public', table: 'space_messages', filter: `space_id=eq.${spaceId}` },
      (payload: any) => {
        onInsert(toMessage(payload.new as SpaceMessageRow));
      },
    )
    .on(
      'postgres_changes' as any,
      { event: 'DELETE', schema: 'public', table: 'space_messages', filter: `space_id=eq.${spaceId}` },
      (payload: any) => {
        if (onDelete) onDelete(payload.old?.id ?? '');
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
