-- ============================================================================
-- SyncDay — Todos Enhancement Migration
-- Migration: 004_todos_enhancement.sql
-- Run AFTER: 002_rls_policies.sql
-- ============================================================================

-- ─── TODOS: 신규 컬럼 추가 ───────────────────────────────────────────────────

-- content_type: 'todo' | 'note' (ADR-003: Notes는 별도 테이블 없이 todos 재사용)
ALTER TABLE public.todos
  ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'todo'
    CHECK (content_type IN ('todo', 'note'));

-- sort_order: 사용자 정의 정렬 순서 (drag-to-reorder용)
ALTER TABLE public.todos
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- event_id: 이벤트와 Todo 연결 FK (이벤트 상세 화면 "관련 할일" 섹션용)
ALTER TABLE public.todos
  ADD COLUMN IF NOT EXISTS event_id UUID
    REFERENCES public.events(id) ON DELETE SET NULL;

-- 참고: completed_at 컬럼은 001_initial_schema.sql에 이미 존재

-- ─── TODOS: 조회 성능 인덱스 ────────────────────────────────────────────────

-- content_type 기준 조회 (Todo 탭 / Notes 탭 분리)
CREATE INDEX IF NOT EXISTS idx_todos_content_type
  ON public.todos(user_id, content_type);

-- sort_order 기준 정렬
CREATE INDEX IF NOT EXISTS idx_todos_sort_order
  ON public.todos(user_id, sort_order);

-- ─── CATEGORIES: 시스템 기본 카테고리 지원 ───────────────────────────────────
-- user_id = NULL → 시스템 기본 카테고리 (수정/삭제 불가)
-- user_id = UUID → 사용자 정의 카테고리

-- user_id를 nullable로 변경 (시스템 카테고리는 특정 사용자에 속하지 않음)
ALTER TABLE public.categories
  ALTER COLUMN user_id DROP NOT NULL;

-- 기존 unique(user_id, name) 제약 제거
-- PostgreSQL에서 NULL은 unique 비교 시 != NULL로 처리되어 중복 가능성이 있으므로
-- partial unique index로 교체
ALTER TABLE public.categories
  DROP CONSTRAINT IF EXISTS categories_user_id_name_key;

-- 사용자 정의 카테고리: 같은 사용자 내 이름 중복 방지
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_user_name
  ON public.categories(user_id, name)
  WHERE user_id IS NOT NULL;

-- 시스템 카테고리: 이름 중복 방지
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_system_name
  ON public.categories(name)
  WHERE user_id IS NULL;

-- ─── CATEGORIES: 시스템 카테고리 RLS 정책 추가 ───────────────────────────────
-- 기존 "categories_all_own" 정책은 auth.uid() = user_id 조건으로 NULL 행을 제외
-- 시스템 카테고리(user_id IS NULL)를 모든 인증 사용자가 읽을 수 있도록 추가

CREATE POLICY "categories_select_system"
  ON public.categories FOR SELECT
  USING (user_id IS NULL);

-- ─── CATEGORIES: 기본 카테고리 Seed 데이터 ──────────────────────────────────

INSERT INTO public.categories (id, name, color, icon, user_id) VALUES
  ('00000000-0000-0000-0000-000000000001', '개인', '#4A90E2', 'person',    NULL),
  ('00000000-0000-0000-0000-000000000002', '업무', '#E24A4A', 'briefcase', NULL),
  ('00000000-0000-0000-0000-000000000003', '기타', '#9B9B9B', 'tag',       NULL)
ON CONFLICT DO NOTHING;
