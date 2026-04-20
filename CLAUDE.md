# SyncDay — Project Context

이 파일은 모든 Claude Code 세션에서 자동으로 로드됩니다.
모든 에이전트(LEAD, DEV, QA)가 공통으로 참조하는 프로젝트 컨텍스트입니다.

## 프로젝트 개요

**SyncDay**는 AI 기반 일정 공유 앱입니다. 커플, 팀, 가족 등 누구와도
Space를 만들어 일정을 공유하고, AI가 자연스럽게 일정 관리를 돕습니다.

### 핵심 가치 제안

- **누구와도 공유**: 커플 전용이 아닌 범용 공유 (Space 기반 N:M 구조)
- **AI 내장**: 별도 AI 탭 없이 기존 UX에 자연스럽게 통합
- **비용 효율**: 로컬 파서로 90% 처리, AI는 꼭 필요할 때만 호출

## 기술 스택 (변경 금지)

- Frontend: React Native (Expo SDK 52+) + TypeScript strict mode
- Backend: Supabase (Auth, PostgreSQL, Realtime, Edge Functions)
- AI: Claude API (Haiku / Sonnet), Edge Functions 프록시 경유
- Push: Expo Notifications
- State: Zustand
- Navigation: Expo Router (file-based)

## 절대 규칙

### 아키텍처
- 컴포넌트에서 Supabase 클라이언트 직접 호출 금지
- 반드시 `src/services/` 의 서비스 레이어 경유
- 서비스는 어댑터 패턴으로 작성 (추후 백엔드 교체 대응)

### AI 비용 최적화
- 자연어 파싱은 `src/lib/nlParser.ts` 로컬 파서 우선
- confidence: 'low' 일 때만 AI fallback
- 스마트 리마인더는 pg_cron 배치로 하루 1회 처리

### 보안
- API 키는 Edge Functions에만 존재, 클라이언트 노출 금지
- 모든 테이블에 RLS (Row Level Security) 정책 적용
- 사용자 입력은 DB 쿼리 전 sanitize

### 코드 스타일
- TypeScript strict mode, any 타입 지양
- 함수형 컴포넌트 + Hooks
- 커밋 메시지: conventional commits (feat/fix/refactor/style/test/docs/chore)
- 코드/주석은 영어, 태스크/이슈 설명은 한국어

## 폴더 구조

```
src/
  app/                  # Expo Router 화면
    (tabs)/             # 하단 탭 화면 (index, calendar, planner, my)
    event/[id].tsx      # 일정 상세
    space/[id].tsx      # Space 상세
  components/           # 재사용 가능한 UI 컴포넌트
  services/             # 비즈니스 로직 (Supabase 호출은 여기만)
  lib/                  # 유틸리티 (nlParser, dateUtils 등)
  types/                # TypeScript 타입 정의
  stores/               # Zustand 스토어
  constants/            # 디자인 토큰, 설정값
```

## 파일 기반 소통

에이전트끼리는 파일을 통해 소통합니다.

```
docs/
  tasks/           ← LEAD가 생성, DEV가 읽고 구현
  issues/          ← QA가 생성 (Open), DEV가 수정 후 closed/로 이동
  issues/closed/   ← 해결된 이슈 아카이브
  architecture/    ← LEAD가 관리 (기술 의사결정, ADR)
  handoffs/        ← 스프린트별 에이전트 재시작 프롬프트
  review/          ← QA가 작성 (스프린트 리뷰)
  escalations/     ← Level 4 사안 (사람 승인 필요 시만)
```

## 참고 문서

- `docs/PRD.md` — 제품 요구사항 정의서
- `docs/SPRINT_PLAN.md` — 스프린트 계획 및 태스크 브레이크다운
- `docs/AGENTS.md` — 팀 구조 및 워크플로우

## 각 에이전트 역할 요약

| 에이전트 | 역할 | 파일 권한 |
|---------|------|---------|
| LEAD | 아키텍처 설계, 태스크 분배, scaffold 생성 | docs/tasks/, docs/architecture/, src/types/, src/services/ (stub) |
| DEV | 기능 구현, 서비스 로직 작성 | src/ 전체 (LEAD가 만든 타입 준수) |
| QA | 테스트 작성, 코드 리뷰, 이슈 리포트 | __tests__/, docs/issues/, docs/review/ |

세부 프롬프트는 `.claude/agents/` 하위 파일 참조.

---

## 자율성 규칙 (모든 에이전트 필독)

이 프로젝트는 자율 에이전트 시스템으로 운영됩니다.
각 에이전트는 기본적으로 자율 판단하되, 명시된 경우에만 상위 권한에 escalate 합니다.

**반드시 읽을 문서:**
- `docs/AUTONOMY.md` — 자율성 레벨 및 escalation 규칙
- `docs/PROTOCOL.md` — 에이전트 간 소통 방식
- `docs/RETROSPECTIVE.md` — 자기 개선 메커니즘

**4단계 자율성:**
1. Level 1 (자율): 즉시 실행, 보고 불필요
2. Level 2 (동료 승인): 다른 에이전트가 PROPOSAL 검토
3. Level 3 (알림): 진행하되 NOTIFY 파일 기록
4. Level 4 (사람 승인): 작업 중단하고 ESCALATION 작성

**모호하면 한 단계 높은 레벨로 처리합니다.**

## LEAD 자가 핸드오프 규칙 ← 최우선 준수

LEAD 세션은 언제든 `/clear`될 수 있다. 따라서:

1. **작업 단위 완료마다** `docs/handoffs/sprint-N/LEAD.md` 즉시 업데이트
2. **사용자에게 무언가 알리기 전에** 먼저 파일을 갱신
3. **파일 내용이 곧 재시작 프롬프트** — 읽기만 해도 완전한 컨텍스트 복원 가능해야 함
4. 재시작 후 사용자에게 알릴 메시지: `docs/handoffs/sprint-N/LEAD.md 읽고 진행해`

---

## 세션 시작 루틴

### 역할 감지

사용자가 핸드오프 파일 경로를 제시하거나 역할을 언급하면 즉시 해당 파일을 읽고 컨텍스트를 복원한다.

- `docs/handoffs/sprint-N/LEAD.md` → LEAD 역할로 진행
- `docs/handoffs/sprint-N/DEV.md` → DEV 역할로 진행
- `docs/handoffs/sprint-N/QA.md` → QA 역할로 진행

### LEAD 자율 진행 모드

사용자가 **"진행해"** 또는 **"자율로 진행해"** 라고 하면, LEAD는 다음을 실행한다:

1. 현재 스프린트 핸드오프 파일에서 미완료 태스크 파악
2. Agent 툴로 DEV 에이전트를 spawn (필요 시 background=true)
   - prompt에 `docs/handoffs/sprint-N/DEV.md` 전체 내용 전달
3. Agent 툴로 QA 에이전트를 spawn (DEV 완료 후 또는 병렬)
   - prompt에 `docs/handoffs/sprint-N/QA.md` 전체 내용 전달
4. 각 에이전트 결과를 파일에서 확인하고 핸드오프 업데이트
5. 사람 승인 필요 사항만 사용자에게 보고

### 일반 시작 루틴

1. 현재 스프린트 핸드오프 파일 읽기 (역할 파악)
2. `docs/escalations/` 확인 (최우선)
3. 미완료 태스크 확인 후 즉시 시작

## 작업 종료 시 필수 루틴 ← 반드시 지킬 것

스프린트 또는 주요 작업 단위 완료 시 **핸드오프 없이 세션 종료 금지**.
`docs/handoffs/{sprint-N}/` 폴더 아래 본인 역할 파일을 최신 상태로 업데이트:

```
docs/handoffs/
  sprint-1/   LEAD.md  DEV.md  QA.md   ← Sprint 1 완료
  sprint-2/   LEAD.md  DEV.md  QA.md   ← 현재 진행 중이면 여기
```

**각 핸드오프 파일에 반드시 포함할 항목:**

1. **현재 테스트 결과** — `npm test` 수치 (suites / passed / skipped / failed)
2. **완료된 태스크** — 이번 세션에서 끝낸 것
3. **즉시 시작 가능한 다음 태스크** — 선행 조건 포함
4. **알아야 할 변경사항** — 새 mock, 새 파일, 아키텍처 결정, 추가된 패키지
5. **열린 이슈** — `docs/issues/` 중 본인 역할과 관련된 것

**LEAD는 추가로**: DEV.md / QA.md도 함께 갱신 (다른 에이전트 컨텍스트 유지)
