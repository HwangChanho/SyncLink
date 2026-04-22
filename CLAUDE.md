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
- `docs/architecture/ROADMAP.md` — v1.0~v1.2 전체 로드맵
- `docs/architecture/BUDGET_GUARDRAILS.md` — AI/인프라 비용 가드레일
- `docs/launch/V1_LAUNCH_CHECKLIST.md` — v1.0 출시 체크리스트

## 각 에이전트 역할 요약

| 에이전트 | 담당 | 파일 권한 |
|---------|------|---------|
| **LEAD (사용자)** | 스프린트 테마 결정, 아키텍처/BM 승인, 출시 수동 작업, 예산 가드레일 집행 | `docs/handoffs/sprint-N/LEAD.md` 1차 소유자 |
| **Claude (오케스트레이터)** | DEV·QA 에이전트 spawn, 진행 취합, 리스크/비용 리포트 | LEAD.md draft 보조, 스프린트 리포트 |
| DEV | 기능 구현, 서비스 로직 작성 | `src/` 전체 (LEAD가 만든 타입 준수) |
| QA | 테스트 작성, 코드 리뷰, 이슈 리포트 | `__tests__/`, `docs/issues/`, `docs/review/` |

**Claude 단독 결정 상한: Level 2 (동료 승인)**  
Level 3 이상은 반드시 NOTIFY 파일 → 사용자 확인 대기.

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

### 창 역할 감지 및 자동 Monitor 시작

세션이 시작되면 먼저 어느 창인지 판단하고 즉시 Monitor를 켠다.

#### 기획 창 (사용자가 "기획" 언급 또는 PLANNING 컨텍스트)

**영구 플랜모드 규칙 (강도 3)**

기획창은 항상 플랜모드로 동작한다. 다음을 엄수한다:

1. **세션 시작 시 EnterPlanMode 도구 즉시 호출** — 예외 없음.
2. **ExitPlanMode는 사용자 승인용 신호로만 사용** — Claude가 임의로 호출 금지.
   사용자가 플랜 파일을 검토 후 승인하면 하니스가 자동으로 플랜모드를 종료한다.
3. **외부 파일 수정은 단위 작업 단위로만** — 메모리, 핸드오프(`docs/handoffs/`),
   COMMAND.md, RESULT.md, 설정 파일 등 외부 파일 수정은 반드시:
   (a) 플랜 파일에 변경 내용 기록 → (b) ExitPlanMode 호출해 사용자 승인 요청 →
   (c) 승인 후 단위 작업 1회 수행 → (d) **즉시 EnterPlanMode 재호출**.
4. **플랜모드 내 허용 행위**: 읽기(Read/Grep/Glob), 플랜 파일 편집, Monitor 실행,
   AskUserQuestion, 작업창 결과 수신/해석.
5. **플랜모드 내 금지 행위**: `src/`·테스트 수정, COMMAND.md 작성, 커밋, 셸 실행 등
   모든 side-effect. (수신한 결과를 플랜 파일에 기록하는 것은 허용.)

**작업 위임 원칙**: 실 코드 실행·대규모 변경은 기획창이 직접 수행하지 않고
COMMAND.md 설계 → 작업창 위임으로만 처리. 기획창은 "설계·검토·메모리 관리"에 집중.

세션 시작 즉시 다음 두 가지를 이 순서대로 실행한다:

1. EnterPlanMode 도구 호출 (위 규칙에 따라 영구 플랜모드 진입)
2. Monitor 툴을 persistent 모드로 실행 (아래 python3 스크립트)

Monitor 스크립트:
```
python3 -c "
import time, hashlib
import os
paths = [
    '/Users/danielhwang/Desktop/Projects/syncday/syncday/docs/handoffs',
    '/Users/danielhwang/Desktop/Projects/syncday/syncday/docs/issues',
    '/Users/danielhwang/Desktop/Projects/syncday/syncday/docs/review',
    '/Users/danielhwang/Desktop/Projects/syncday/syncday/docs/inbox/RESULT.md',
]
state = {}
while True:
    for p in paths:
        try:
            if os.path.isdir(p):
                for f in os.listdir(p):
                    fp = os.path.join(p, f)
                    m = os.path.getmtime(fp)
                    if state.get(fp) and state[fp] != m:
                        print(f'[WORK_RESULT] 변경: {fp}', flush=True)
                    state[fp] = m
            else:
                m = os.path.getmtime(p)
                if state.get(p) and state[p] != m:
                    print(f'[WORK_RESULT] 변경: {p}', flush=True)
                state[p] = m
        except: pass
    time.sleep(1)
"
```

#### 작업 창 (사용자가 "작업" 언급 또는 LEAD/DEV/QA 핸드오프 파일 제시)

세션 시작 즉시:
1. 최신 스프린트 핸드오프 파일 읽고 컨텍스트 복원
2. Monitor 툴을 persistent 모드로 실행:
```
python3 /Users/danielhwang/Desktop/Projects/syncday/syncday/docs/inbox/monitor.py
```
3. 파일 변경 감지 시 COMMAND.md 읽고 즉시 실행 (계획 수립 없이 바로 실행 — 기획 창에서 이미 설계 완료된 명령만 전달됨)

#### 핸드오프 파일로 역할 감지 (기존)

사용자가 핸드오프 파일 경로를 제시하거나 역할을 언급하면 즉시 해당 파일을 읽고 컨텍스트를 복원한다.

- `docs/handoffs/sprint-N/LEAD.md` → LEAD 역할로 진행
- `docs/handoffs/sprint-N/DEV.md` → DEV 역할로 진행
- `docs/handoffs/sprint-N/QA.md` → QA 역할로 진행

### LEAD 자율 진행 모드

사용자가 **"진행해"** 또는 **"자율로 진행해"** 라고 하면, Claude(오케스트레이터)는 다음을 실행한다:

1. 현재 스프린트 핸드오프 파일에서 미완료 태스크 파악
2. Agent 툴로 DEV 에이전트를 spawn (필요 시 background=true)
   - prompt에 `docs/handoffs/sprint-N/DEV.md` 전체 내용 전달
3. Agent 툴로 QA 에이전트를 spawn (DEV 완료 후 또는 병렬)
   - prompt에 `docs/handoffs/sprint-N/QA.md` 전체 내용 전달
4. 각 에이전트 결과를 파일에서 확인하고 핸드오프 업데이트
5. **Level 3 이상 사안**은 NOTIFY 파일 작성 후 사용자 확인 대기
6. 사람 승인 필요 사항만(Level 4) 사용자에게 보고

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
