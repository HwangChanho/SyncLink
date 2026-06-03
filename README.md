# SyncLink

AI 기반 일정 공유 앱 (iOS · Android · Web). 자연어로 입력한 일정을 AI가 구조화하고,
Space(N:M) 단위로 커플·가족·팀이 일정을 공유·동기화합니다.

> 이 저장소는 **하네스 엔지니어링(harness engineering)** 사례로 공개합니다 — 1인 개발에서
> AI 에이전트로 안전하게 프로덕션 앱을 만들고 운영하기 위한 자동화·검증·배포 하네스에
> 초점을 둡니다. 제품 코드보다 **"어떻게 안전하게 굴렸는가"**가 핵심입니다.

---

## 🧰 하네스 엔지니어링

LLM 에이전트는 빠르지만 **"했다고 말하지만 실제론 안 된"** 실패가 잦습니다. 이 프로젝트는
그 실패들을 구조적으로 막는 하네스를 갖췄습니다.

### 1. 검증 하네스 — "코드가 맞다 ≠ 화면이 맞다"

핵심 교훈: `tsc` 통과가 "됐다"를 보장하지 않습니다. 특히 UI 변경은 컴파일러가 못 잡습니다
(예: 노랑 배경 위 노랑 글씨 → 텍스트가 안 보임).

- **변경 유형별 게이트** (로직 / UI / DB·RPC / Edge Function / 배포) 를 빈칸 없이 통과.
- **UI 변경은 실제 렌더 캡처 + 육안 확인 강제** — 시뮬레이터 부팅 → 딥링크 진입 →
  스크린샷 → 요소 크롭까지 반자동화(`scripts/sim-verify.sh`).
- **조건부 UI 는 그 상태로 검증** — Free 전용 요소는 Free 계정 상태에서 확인.
- 보고 규칙: "수정함"이 아니라 **"수정 + [검증 방법]으로 확인함"**. 미검증은 명시.

### 2. 멀티에이전트 개발 하네스

역할을 분리한 Claude Code 에이전트가 협업하되, **단독 결정 상한을 둡니다.**

- 역할: LEAD(사람) / DEV(구현) / QA(테스트·회귀) / DEVOPS(빌드·배포).
- **자율성 레벨 1~4** — Level 4(비용·보안·배포)는 **사람 승인 필수**.
- **비용 가드레일** — 에이전트 spawn 은 컨텍스트 재빌드라 비싸므로 최소화, 큰 작업은 phase 분할.

### 3. 배포 하네스 — 3채널 + 무결성 검사

- **웹**(Cloudflare Pages) / **OTA**(Expo Updates) / **TestFlight**(fastlane).
- **JS-only 변경은 웹+OTA로 즉시 반영**, 네이티브 변경만 스토어 빌드.
- **버전 4-소스 일치 검사** — app.json · xcodeproj · iOS/위젯 Info.plist 의 marketing
  버전을 fastlane 이 자동 sync·검증(불일치 시 차단).
- 배포 해시·버전은 **실제 출력값만 기록**(추정 금지).

### 4. 안전 가드

- **하드웨어 뮤텍스** — 빌드 중 시뮬레이터 동시 실행 금지(OOM·archive 권한 충돌 방지).
- **DB 마이그레이션 사전 점검** — 미적용분만 push, `check_function_bodies` 로 참조 검증.
- **되돌리기 어려운 작업**(계정 병합, 비밀 회전, public 전환)은 **실측 검증 후에만** 실행.

---

## 🏗️ 아키텍처

```
Frontend   React Native (Expo) + TypeScript (strict) + Zustand + Expo Router
Backend    Supabase — Auth · PostgreSQL(RLS) · Realtime · Edge Functions
AI         Claude API (Haiku/Sonnet) — 로컬 파서 우선, 저신뢰 시에만 AI fallback
결제       RevenueCat (구독), appUserID = Supabase user UUID
```

**설계 원칙**
- 컴포넌트는 Supabase 직접 호출 금지 → `src/services/` 서비스 레이어 경유.
- **모든 테이블 RLS**, API 키는 **Edge Functions 에만**(클라이언트 미노출).
- AI 비용 통제: 로컬 정규식 파서로 대부분 처리, confidence 낮을 때만 LLM 호출.

```
src/
  app/         Expo Router 화면 ((tabs)/, event/, space/, auth/, settings/)
  components/  UI 컴포넌트
  services/    비즈니스 로직 (Supabase 호출은 여기만)
  lib/         nlParser, supabase, dateUtils 등
  stores/      Zustand 스토어
  locales/     ko/en/zh/ja i18n
supabase/
  functions/   Edge Functions (AI 프록시, 푸시, 웹훅 등)
  migrations/  스키마 + RPC (RLS·security definer)
scripts/       sim-verify 등 검증·운영 하네스
```

---

## 🚀 로컬 실행

```bash
npm install
cp .env.example .env        # Supabase·Claude·RevenueCat 등 키 채우기
npm run web                 # 웹
npx expo run:ios            # iOS 시뮬레이터
```

> 비밀(.env, 서비스 키, 인증서)은 저장소에 포함되지 않습니다. 자체 Supabase/Claude
> 프로젝트와 키가 필요합니다.

---

## 주요 기능

- **AI 자연어 일정** — "다음 주 화요일 저녁 7시 회의" → 구조화된 이벤트.
- **Space 공유** — N:M 그룹 캘린더, 실시간 동기화, 권한별 편집.
- **분석 대시보드** (Pro) — 카테고리·요일·시간대 히트맵, 기간 비교, AI 인사이트.
- **통합 로그인** — Google·Kakao·Apple, 동일 이메일 계정 통합(Pro 우선 병합).

---

## 라이선스 / 상태

개인 프로젝트. iOS App Store 출시 후 실사용자 운영 중. 코드는 참고·학습 목적 공개이며,
제품 운영에 쓰이는 비밀·내부 운영 문서는 포함되지 않습니다.
