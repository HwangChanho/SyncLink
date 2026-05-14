/**
 * todoAttachmentService — Todo(note) 사진/음성 첨부 CRUD.
 *
 * Plan: docs/plans/2026-05-14-note-attachments.md
 *
 * 흐름:
 *  1. uploadPhoto / uploadVoice — local URI 를 Supabase Storage 에 업로드
 *     후 todo_attachments row 생성
 *  2. listByTodo — 특정 todo 의 첨부 목록 + signed URL 반환
 *  3. remove — DB row 삭제 + Storage 객체 삭제
 *
 * 5개 제한은 DB trigger 가 enforce (errcode P0001).
 */

import { supabase, getCurrentUserId } from '@/lib/supabase';
import { logError, serializePgError } from '@/lib/errorLogger';
import type { TodoAttachmentRow, TodoAttachmentKindDb } from '@/types';

const BUCKET = 'todo-attachments';
const SIGNED_URL_TTL = 60 * 60; // 1 hour

// supabase-js v2 Database 제네릭 한계 우회
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supa = supabase as any;

/** Hydrated row with a signed URL ready for `<Image>` / `<Audio>`. */
export interface TodoAttachment extends TodoAttachmentRow {
  signedUrl: string;
}

// ─── Upload helpers ───────────────────────────────────────────────────────────

/**
 * Upload a photo (JPEG/PNG/HEIC) and insert the attachment row.
 *
 * Uploader supplies the base64 payload because Expo's ImagePicker already
 * decodes the file for us; passing the URI separately would force a second
 * read from disk.
 */
export async function uploadPhoto(
  todoId: string,
  localUri: string,
  base64: string,
  meta: { width?: number; height?: number },
): Promise<TodoAttachmentRow> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const ext = inferExt(localUri, 'jpg');
  const path = `${todoId}/${cryptoRandomId()}.${ext}`;
  const contentType = mimeForExt(ext);
  // Convert base64 → Blob via data URL fetch (no extra dependency on
  // base64-arraybuffer; works in RN + Web).
  const blob = await (await fetch(`data:${contentType};base64,${base64}`)).blob();

  const { error: upErr } = await supa.storage
    .from(BUCKET)
    .upload(path, blob, { contentType, upsert: false });
  if (upErr) throw new Error(`사진 업로드 실패: ${upErr.message}`);

  return insertRow({
    todoId,
    userId,
    kind: 'photo',
    storagePath: path,
    width: meta.width ?? null,
    height: meta.height ?? null,
    sizeBytes: blob.size,
    durationMs: null,
  });
}

/**
 * Upload a voice memo (m4a/aac) recorded via expo-av and insert the row.
 *
 * The file lives at `localUri` on the device after the recording stops;
 * we read it as a fetch Blob since expo-av does not expose base64.
 */
export async function uploadVoice(
  todoId: string,
  localUri: string,
  durationMs: number,
): Promise<TodoAttachmentRow> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const path = `${todoId}/${cryptoRandomId()}.m4a`;
  // expo-av recordings are file:// — convert to a Blob for the upload body
  const res = await fetch(localUri);
  const blob = await res.blob();

  const { error: upErr } = await supa.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: 'audio/m4a', upsert: false });
  if (upErr) throw new Error(`음성 업로드 실패: ${upErr.message}`);

  return insertRow({
    todoId,
    userId,
    kind: 'voice',
    storagePath: path,
    width: null,
    height: null,
    sizeBytes: blob.size,
    durationMs,
  });
}

// ─── Query / mutate ───────────────────────────────────────────────────────────

/** List all attachments for a todo, hydrated with signed URLs. */
export async function listByTodo(todoId: string): Promise<TodoAttachment[]> {
  const { data, error } = await supa
    .from('todo_attachments')
    .select('*')
    .eq('todo_id', todoId)
    .order('created_at', { ascending: true });
  if (error) {
    logError({ context: 'todoAttachments.list', error: serializePgError(error) });
    return [];
  }

  const rows = (data ?? []) as TodoAttachmentRow[];
  return Promise.all(rows.map(async (r) => ({
    ...r,
    signedUrl: await getSignedUrl(r.storage_path),
  })));
}

/**
 * Delete an attachment — removes both the storage object and the DB row.
 * Errors during storage cleanup are logged but do not block the row delete:
 * the DB row is the source of truth for UI visibility.
 */
export async function remove(attachmentId: string): Promise<void> {
  const { data: row, error: selErr } = await supa
    .from('todo_attachments')
    .select('storage_path')
    .eq('id', attachmentId)
    .maybeSingle();
  if (selErr) throw new Error(selErr.message);
  if (!row) return;

  const { error: stErr } = await supa.storage.from(BUCKET).remove([row.storage_path]);
  if (stErr) logError({ context: 'todoAttachments.storageRemove', error: stErr });

  const { error: delErr } = await supa
    .from('todo_attachments')
    .delete()
    .eq('id', attachmentId);
  if (delErr) throw new Error(delErr.message);
}

/** Issue a signed URL for a storage path (1 hour TTL). */
export async function getSignedUrl(storagePath: string): Promise<string> {
  const { data, error } = await supa.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL);
  if (error || !data?.signedUrl) {
    logError({ context: 'todoAttachments.signedUrl', error });
    return '';
  }
  return data.signedUrl;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface InsertArgs {
  todoId:       string;
  userId:       string;
  kind:         TodoAttachmentKindDb;
  storagePath:  string;
  durationMs:   number | null;
  width:        number | null;
  height:       number | null;
  sizeBytes:    number | null;
}

async function insertRow(args: InsertArgs): Promise<TodoAttachmentRow> {
  const { data, error } = await supa
    .from('todo_attachments')
    .insert({
      todo_id:      args.todoId,
      user_id:      args.userId,
      kind:         args.kind,
      storage_path: args.storagePath,
      duration_ms:  args.durationMs,
      width:        args.width,
      height:       args.height,
      size_bytes:   args.sizeBytes,
    })
    .select()
    .single();

  if (error) {
    // 5개 제한 트리거가 raise 하는 사용자 친화 메시지
    if ((error.code === 'P0001' || error.message?.includes('TODO_ATTACHMENTS_LIMIT'))) {
      throw new Error('첨부는 최대 5개까지 등록할 수 있습니다.');
    }
    throw new Error(error.message ?? '첨부 등록에 실패했습니다.');
  }
  return data as TodoAttachmentRow;
}

function inferExt(uri: string, fallback: string): string {
  const m = uri.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  return (m?.[1] ?? fallback).toLowerCase();
}

function mimeForExt(ext: string): string {
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'heic':
      return 'image/heic';
    case 'heif':
      return 'image/heif';
    case 'm4a':
      return 'audio/m4a';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Tiny random ID for storage filenames. crypto.randomUUID is not always
 * present in RN; fall back to Math.random for the rare unsupported runtime.
 */
function cryptoRandomId(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
