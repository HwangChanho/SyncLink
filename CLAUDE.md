# SyncDay — Project Context

모든 Claude Code 세션 + 에이전트(LEAD, DEV, QA, DEVOPS)가 공통으로 참조하는 프로젝트 컨텍스트.

## 프로젝트 개요

**SyncDay**: AI 기반 일정 공유 앱. Space(N:M) 기반 커플·팀·가족 공유, AI 일정 관리 통합.

**기술 스택 (변경 금지)**
- Frontend: React Native (Expo SDK 52+) + TypeScript strict mode
- Backend: Supabase (Auth, PostgreSQL, Realtime, Edge Functions)
- AI: Claude API (Haiku/Sonnet), Edge Functions 프록시 경유
- State: Zustand | Navigation: Expo Router (file-based)

## 절대 규칙

### 아키텍처
- 컴포넌트에서 Supabase 직접 호출 금지 → `src/services/` 서비스 레이어 경유 필수
- AI: `src/lib/nlParser.ts` 로컬 파서 우선, confidence='low' 일 때만 AI fallback
- API 키는 Edge Functions에만 존재, 모든 테이블에 RLS 적용

### 코드 스타일
- TypeScript strict, any 지양 | 함수형 컴포넌트 + Hooks
- 커밋: conventional commits | 코드/주석: 영어, 이슈/태스크: 한국어

### ⚠️ 하드웨어 뮤텍스 (MacBook Air M2 16GB — 위반 시 OOM 강제 종료)
- **iOS Simulator + Android AVD 동시 실행 절대 금지**
- **Android 빌드는 EAS Build(클라우드) 전담** — 로컬 `expo run:android` 금지
- `/qa all` = ios-sim → web 순차 실행. android-sim 병렬 spawn 금지
- 에이전트 동시 실행 상한: **최대 2개** (메인 세션 + 작업 에이전트 1개)
- 빌드 중(`expo run:ios`, `fastlane beta`) 다른 Heavy 작업 금지

상세 규칙: `docs/DEPLOY_RULES.md`

## 폴더 구조

```
src/
  app/          # Expo Router 화면 ((tabs)/, event/, space/, auth/, settings/)
  components/   # UI 컴포넌트 (calendar/, common/, home/, space/, event/, nl/)
  services/     # 비즈니스 로직 (Supabase 호출은 여기만)
  lib/          # nlParser, themePalette, supabase, dateUtils 등
  stores/       # Zustand 스토어
  types/        # TypeScript 타입 정의
  constants/    # 디자인 토큰, 설정값
  hooks/        # useColors, useSpeechRecognition 등
  locales/      # ko/en/zh/ja i18n 키
docs/
  tasks/        ← LEAD 생성, DEV 구현
  issues/       ← QA 생성(Open), fix 후 closed/로 이동
  architecture/ ← ADR, DECISIONS.md
  handoffs/     ← 스프린트별 에이전트 재시작 프롬프트
  escalations/  ← Level 4 사안만
  plans/        ← 큰 작업 plan 문서
  queue/        ← todo/done
```

## 에이전트 역할

| 에이전트 | 담당 |
|---------|------|
| **LEAD (사용자)** | 스프린트 결정, 아키텍처 승인, Level 4 승인 |
| DEV | `src/` 기능 구현, 큰 변경 직전에 plan 파일 작성 |
| QA | `__tests__/`, `docs/issues/`, e2e |
| qa-{ios-sim, web} | 시뮬 회귀 (**순차**) — `/qa ios-sim` → `/qa web` |
| qa-{android-sim, ios-device, android-device} | 개별 실행 (뮤텍스 주의) |
| DEVOPS | 빌드/배포, CI/CD, 인증서 관리 |

Sub-agent 정의: `.claude/agents/` | QA 디스패처: `.claude/commands/qa.md`

**비용 가드레일 (Max $100 플랜)**: 에이전트 spawn은 cold start 비용이 큼 — PM/TRIAGE/ARCHITECT류 별도 에이전트 금지, 그 책임은 LEAD/메인 세션이 직접. 병렬 탐색이 정말 필요할 때만 Explore/일반 에이전트.

## 자율성 레벨

| 레벨 | 동작 |
|------|------|
| Level 1 | 즉시 실행, 보고 불필요 (단일 파일 수정, 정보 조회) |
| Level 2 | 동료 에이전트 PROPOSAL 검토 후 실행 |
| Level 3 | 진행 + NOTIFY 파일 기록 |
| Level 4 | 중단 + ESCALATION 파일 → 사용자 확인 필수 |

**Claude 단독 결정 상한: Level 2.** 모호하면 한 단계 높게 처리.  
상세: `docs/AUTONOMY.md`

## 큰 작업 플랜 규칙

1. 작업 전 `docs/plans/{YYYY-MM-DD}-{topic}.md` 작성 (목적·단계·롤백)
2. 사용자 승인 대기 후 실행
3. 완료 후 plan 파일 하단에 "실행 결과" 추가
4. 환경변수·셋업 변경 시 `docs/REBOOT_CHECKLIST.md` 즉시 갱신

작은 작업 (단일 파일 수정, 명령 실행): plan 생략 OK.

## 세션 시작 루틴

> **부트 매뉴얼**: `docs/SESSION_BOOT.md` — 새 세션/스프린트/페이즈 재시작 시 이 파일을
> 가장 먼저 읽는다. 자율 모드 위임 받았을 때의 운영 규칙도 여기에 정의돼 있다.

1. (기획 창) Monitor 툴 persistent 모드 즉시 실행 — 감시: `docs/handoffs/`, `docs/issues/`, `docs/review/`, `docs/inbox/RESULT.md`, 변경 감지 시 `[WORK_RESULT] 변경: {파일명}` 출력
2. `docs/SESSION_BOOT.md` 의 부트 체크리스트 8단계 실행
3. `docs/handoffs/sprint-N/LEAD.md` + `RESUME.md` 컨텍스트 복원
4. `docs/issues/` 미해결 이슈 확인 후 미완료 태스크부터 즉시 시작

## 핸드오프 규칙

세션 종료 전 `docs/handoffs/sprint-N/` 본인 역할 파일 반드시 갱신.  
포함 항목: 테스트 수치, 완료 태스크, 다음 태스크(선행 조건), 변경사항, 열린 이슈.

## 배포 체크리스트

TestFlight 업로드 전 `docs/QA_CHECKLIST.md` 5개 게이트 통과 필수.  
**배포 규칙 전문**: `docs/DEPLOY_RULES.md`

## ⚠️ 검증 체크리스트 (필수 — "수정했다" 보고 전)

`docs/VERIFICATION_CHECKLIST.md` 를 변경 유형별로 빈칸 없이 통과시킨다.
- **UI 시각 변경은 tsc 로 검증 안 됨** → 반드시 `scripts/sim-verify.sh` 로
  실제 렌더 캡처 + 크롭 육안 확인. 조건부 UI(Free 전용 등)는 그 상태로 봐야 함.
- 배포 해시/버전은 **실제 출력값**만 기록(추정 금지).
- 보고는 "수정함"이 아니라 "수정 + [검증방법]으로 확인함". 미검증은 "미검증" 명시.

## 참고 문서

- `docs/SESSION_BOOT.md` — **세션 재시작용 role + 부트 체크리스트 (필독)**
- `docs/PRD.md` — 제품 요구사항
- `docs/SPRINT_PLAN.md` — 스프린트 계획
- `docs/architecture/DECISIONS.md` — ADR 목록
- `docs/architecture/BUDGET_GUARDRAILS.md` — AI/인프라 비용 가드레일
- `docs/launch/V1_LAUNCH_CHECKLIST.md` — v1.0 출시 체크리스트
