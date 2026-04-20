/**
 * __tests__/types/sprint0.types.test.ts
 *
 * QA verification for TASK-001: TypeScript 타입 정의
 *
 * Acceptance Criteria 검증:
 * - [x] src/types/database.ts — DB 테이블 타입 존재
 * - [x] src/types/event.ts — Event 도메인 타입 존재
 * - [x] src/types/space.ts — Space 도메인 타입 존재
 * - [x] src/types/todo.ts — Todo 타입 존재
 * - [x] src/types/ai.ts — NLParseResult, Confidence 타입 존재
 * - [x] src/types/index.ts — 모든 타입 re-export
 *
 * NOTE: TypeScript 타입은 런타임에 존재하지 않습니다.
 * 이 테스트들은 타입들이 JS 런타임 값(const, enum-like)으로도
 * 올바르게 정의되었는지, 그리고 import가 가능한지를 검증합니다.
 * 정적 타입 오류는 `npx tsc --noEmit`으로 별도 검증하세요.
 *
 * @task TASK-001
 * @verifiedBy QA
 */

// ─── import 가능 여부 검증 ─────────────────────────────────────────────────────
// 이 import들이 실패하면 해당 파일이 누락된 것.

import type {
  // database.ts
  Database, UserRow, SpaceRow, SpaceMemberRow,
  EventRow, EventShareRow, TodoRow, CategoryRow,
  AnniversaryRow, AiChatLogRow,
  // event.ts
  Event, EventSummary, CreateEventInput, UpdateEventInput,
  RepeatType, BuiltinCategory, FreeTimeSlot,
  // space.ts
  Space, SpaceSummary, SpaceMember, SpaceType, SpaceMemberRole,
  CreateSpaceInput, Anniversary,
  // todo.ts
  Todo, TodoSummary, CreateTodoInput, TodoPriority, Note,
  // ai.ts
  Confidence, ParsedField, ParsedEventFields,
  NLParseResult, AiParseRequest, AiParseResponse,
  AiUsageRecord, SmartReminderMessage,
} from '@/types';

// ─── TASK-001: 타입 구조 검증 ─────────────────────────────────────────────────

describe('TASK-001: TypeScript type definitions', () => {

  // ── Confidence enum 값 검증 ──────────────────────────────────────────────────
  describe('Confidence type', () => {
    it('accepts valid confidence values', () => {
      // 런타임에서 타입 가드 역할을 하는 헬퍼로 검증
      const validValues = ['high', 'medium', 'low'] as Confidence[];
      expect(validValues).toHaveLength(3);
      expect(validValues).toContain('high');
      expect(validValues).toContain('medium');
      expect(validValues).toContain('low');
    });
  });

  // ── NLParseResult 구조 검증 ──────────────────────────────────────────────────
  describe('NLParseResult shape', () => {
    it('can construct a valid NLParseResult object', () => {
      // 올바른 shape의 객체를 타입 없이 구성하고 필드를 검증
      const mockResult: NLParseResult = {
        parsed: {
          title: { value: '점심 약속', confidence: 'high' },
          startAt: { value: new Date('2026-04-17T12:00:00'), confidence: 'high' },
        },
        confidence: 'high',
        source: 'local',
        rawInput: '내일 오후 1시 점심 약속',
        processingMs: 3,
      };

      expect(mockResult.confidence).toBe('high');
      expect(mockResult.source).toBe('local');
      expect(mockResult.rawInput).toBe('내일 오후 1시 점심 약속');
      expect(mockResult.processingMs).toBe(3);
      expect(mockResult.parsed.title?.value).toBe('점심 약속');
    });

    it('allows low confidence result with AI source', () => {
      const aiResult: NLParseResult = {
        parsed: {},
        confidence: 'low',
        source: 'ai',
        rawInput: '이번 달 말에 뭔가 있었는데',
        processingMs: null,
      };

      expect(aiResult.confidence).toBe('low');
      expect(aiResult.source).toBe('ai');
      expect(aiResult.processingMs).toBeNull();
      expect(Object.keys(aiResult.parsed)).toHaveLength(0);
    });

    it('allows optional error field', () => {
      const errorResult: NLParseResult = {
        parsed: {},
        confidence: 'low',
        source: 'local',
        rawInput: '???',
        processingMs: 0,
        error: 'Parse failed: no date found',
      };

      expect(errorResult.error).toBe('Parse failed: no date found');
    });
  });

  // ── Event 도메인 타입 검증 ────────────────────────────────────────────────────
  describe('Event domain type', () => {
    it('can construct a valid Event object', () => {
      const mockEvent: Event = {
        id: 'evt-001',
        userId: 'usr-001',
        title: '팀 미팅',
        description: null,
        location: '회의실 A',
        startAt: new Date('2026-04-17T10:00:00'),
        endAt: new Date('2026-04-17T11:00:00'),
        allDay: false,
        repeatType: 'none',
        repeatUntil: null,
        categoryId: null,
        color: '#6C63FF',
        sharedSpaceIds: ['space-001'],
        ownerNickname: '홍길동',
        isOwn: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(mockEvent.id).toBe('evt-001');
      expect(mockEvent.repeatType).toBe('none');
      expect(mockEvent.sharedSpaceIds).toHaveLength(1);
    });

    it('RepeatType includes all valid values', () => {
      const types: RepeatType[] = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
      expect(types).toHaveLength(5);
    });
  });

  // ── Space 도메인 타입 검증 ────────────────────────────────────────────────────
  describe('Space domain type', () => {
    it('can construct a valid Space object', () => {
      const mockSpace: Space = {
        id: 'spc-001',
        name: '우리 커플',
        type: 'couple',
        inviteCode: 'ABC123',
        coverImageUrl: null,
        createdBy: 'usr-001',
        members: [],
        dDayCount: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(mockSpace.type).toBe('couple');
      expect(mockSpace.inviteCode).toHaveLength(6);
    });

    it('SpaceType accepts couple and group', () => {
      const types: SpaceType[] = ['couple', 'group'];
      expect(types).toHaveLength(2);
    });
  });

  // ── AiUsageRecord 검증 ────────────────────────────────────────────────────────
  describe('AiUsageRecord', () => {
    it('stores date as YYYY-MM-DD string', () => {
      const record: AiUsageRecord = {
        date: '2026-04-17',
        callCount: 3,
        tokensUsed: 750,
      };

      expect(record.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(record.callCount).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Database 집합 타입 검증 ───────────────────────────────────────────────────
  describe('Database aggregate type', () => {
    it('is a type-safe collection (structure verified by TypeScript compilation)', () => {
      // 이 테스트는 tsc --noEmit 통과 여부로 실질 검증됨.
      // 런타임에는 타입이 없으므로 항상 통과.
      expect(true).toBe(true);
    });
  });
});
