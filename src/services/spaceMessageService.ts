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

import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { supabase, getCurrentUserId } from '@/lib/supabase';

export interface SpaceMessage {
  id:        string;
  spaceId:   string;
  senderId:  string;
  body:      string | null;
  imageUrl:  string | null;
  /** v1.2.1 — AI 자동 태그 1–3개 (한국어). null = 미분석. */
  tags:      string[] | null;
  createdAt: Date;
}

interface SpaceMessageRow {
  id:         string;
  space_id:   string;
  sender_id:  string;
  body:       string | null;
  image_url:  string | null;
  tags:       string[] | null;
  created_at: string;
}

function toMessage(row: SpaceMessageRow): SpaceMessage {
  return {
    id:        row.id,
    spaceId:   row.space_id,
    senderId:  row.sender_id,
    body:      row.body,
    imageUrl:  row.image_url,
    tags:      row.tags ?? null,
    createdAt: new Date(row.created_at),
  };
}

/** 최근 메시지 목록 (newest first). 메시지 화면은 inverted FlatList 권장. */
export async function listMessages(spaceId: string, limit: number = 50): Promise<SpaceMessage[]> {
  const { data, error } = await supabase
    .from('space_messages')
    .select('id, space_id, sender_id, body, image_url, tags, created_at')
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

  // 압축 — 옛 manipulateAsync API (호환성 안정).
  const manipulated = await manipulateAsync(
    localUri,
    [{ resize: { width: 1024 } }],
    { compress: 0.8, format: SaveFormat.JPEG },
  );

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
  const msg = toMessage(data as SpaceMessageRow);

  // v1.2.1 — AI 자동 태그 (백그라운드, 실패해도 메시지 전송엔 영향 X).
  void analyzeImageMessage(msg.id).catch(() => { /* silent fail */ });

  return msg;
}

/**
 * 백그라운드로 analyze-image Edge Fn 호출. 결과는 DB 의 tags 컬럼이 갱신되고
 * Realtime postgres_changes 가 UPDATE 이벤트를 보내면 클라이언트가 자동 반영.
 * (단, 현재 subscribe 는 INSERT/DELETE 만 받음 → 다음 listMessages 호출 또는
 *  새 메시지 도착 시까지 tags 안 보일 수 있음. 후속 개선 여지.)
 */
async function analyzeImageMessage(messageId: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const jwt = session?.access_token;
  if (!jwt) return;
  await supabase.functions.invoke('analyze-image', {
    body: { messageId },
  });
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
  onUpdate?: (msg: SpaceMessage) => void,
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
    .on(
      'postgres_changes' as any,
      { event: 'UPDATE', schema: 'public', table: 'space_messages', filter: `space_id=eq.${spaceId}` },
      (payload: any) => {
        // v1.2.1 — AI 분석 결과 tags 컬럼 갱신 등.
        if (onUpdate) onUpdate(toMessage(payload.new as SpaceMessageRow));
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

// ─── v1.2.1 unread badge ────────────────────────────────────────────────────

/**
 * 현재 사용자가 속한 모든 Space 의 안 본 메시지 수.
 * Space 카드/리스트에서 한 번에 보여줄 때 사용.
 */
export async function getUnreadCounts(): Promise<Record<string, number>> {
  const userId = await getCurrentUserId();
  if (!userId) return {};
  const { data, error } = await supabase
    .from('space_unread_counts')
    .select('space_id, unread_count')
    .eq('user_id', userId);
  if (error) return {};
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as { space_id: string; unread_count: number }[]) {
    out[r.space_id] = r.unread_count;
  }
  return out;
}

/**
 * v1.2.3 — 메시지 검색. body 텍스트 substring + tags 항목 매칭.
 * RLS 가 Space 멤버 가시성 검증.
 */
export async function searchMessages(spaceId: string, query: string): Promise<SpaceMessage[]> {
  const q = query.trim();
  if (q.length === 0) return [];
  // body ILIKE + tags array overlap. or() 로 OR 합성.
  const { data, error } = await supabase
    .from('space_messages')
    .select('id, space_id, sender_id, body, image_url, tags, created_at')
    .eq('space_id', spaceId)
    .or(`body.ilike.%${q}%,tags.cs.{${q}}`)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return [];
  return (data ?? []).map((r) => toMessage(r as SpaceMessageRow));
}

/**
 * v1.2.3 — typing indicator broadcast.
 * 사용자가 input 에 글을 쓰는 동안 1초마다 호출 → 다른 멤버 화면에 "OO 입력 중".
 * Realtime broadcast 채널 사용 (DB 비용 0).
 */
export function broadcastTyping(spaceId: string, nickname: string): void {
  const channel = supabase.channel(`typing:${spaceId}`, { config: { broadcast: { self: false } } });
  void channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      void channel.send({ type: 'broadcast', event: 'typing', payload: { nickname, at: Date.now() } });
      // 1.5초 후 unsubscribe — 다음 broadcast 시 재구독.
      setTimeout(() => { void supabase.removeChannel(channel); }, 1500);
    }
  });
}

/**
 * v1.2.3 — typing indicator 구독. 1.5초 안에 같은 사용자에서 신호 안 오면
 * fade out. 반환된 unsubscribe 호출하면 cleanup.
 */
export function subscribeToTyping(
  spaceId: string,
  onTyping: (nickname: string) => void,
): () => void {
  const channel = supabase.channel(`typing:${spaceId}`)
    .on('broadcast', { event: 'typing' }, (payload) => {
      const nick = (payload?.payload as { nickname?: string })?.nickname;
      if (nick) onTyping(nick);
    })
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
}

/** 채팅 화면 진입 시 호출 — last_read_at 을 now() 로 갱신해 badge 0 으로. */
export async function markSpaceAsRead(spaceId: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) return;
  await supabase
    .from('space_members')
    .update({ last_read_at: new Date().toISOString() })
    .eq('space_id', spaceId)
    .eq('user_id', userId);
}

// ─── v1.2.1 채널 알림 토글 ─────────────────────────────────────────────────

/** 현재 사용자의 특정 Space 알림 on/off 상태 조회. */
export async function getSpaceNotificationsEnabled(spaceId: string): Promise<boolean> {
  const userId = await getCurrentUserId();
  if (!userId) return true;
  const { data } = await supabase
    .from('space_members')
    .select('notifications_enabled')
    .eq('space_id', spaceId)
    .eq('user_id', userId)
    .single();
  return data?.notifications_enabled ?? true;
}

/** Space 알림 toggle. */
export async function setSpaceNotificationsEnabled(spaceId: string, enabled: boolean): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) return;
  await supabase
    .from('space_members')
    .update({ notifications_enabled: enabled })
    .eq('space_id', spaceId)
    .eq('user_id', userId);
}
