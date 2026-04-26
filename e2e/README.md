# SyncLink E2E 테스트 (Maestro)

Maestro + iOS 시뮬레이터/Android 에뮬레이터 기반 E2E 자동화.
테스트 실행 중 시뮬레이터 화면을 직접 보면서 진행 상황을 확인할 수 있다.

---

## 1회 설치

```bash
# Maestro 설치
brew tap mobile-dev-inc/tap && brew install maestro

# 설치 확인
maestro --version
```

---

## 앱 빌드 및 시뮬레이터 설치

```bash
# iOS 시뮬레이터에 개발 빌드 설치 (처음 한 번)
npx expo run:ios --simulator

# 이후 실행은
npx expo start --ios
```

---

## 테스트 실행

### 서버 불필요 — 앱 실행 + 로그인 화면 검증
```bash
npm run test:e2e:launch
```

### Dev 로그인 후 탭 네비게이션 검증
```bash
TEST_EMAIL=your@email.com TEST_PASSWORD=yourpassword \
  maestro test e2e/flows/01_login_dev.yaml e2e/flows/02_tab_navigation.yaml
```

### 골든 패스 전체 실행
```bash
TEST_EMAIL=your@email.com TEST_PASSWORD=yourpassword \
  npm run test:e2e:golden
```

### 전체 플로우 순서대로 실행
```bash
TEST_EMAIL=your@email.com TEST_PASSWORD=yourpassword \
  npm run test:e2e
```

---

## 실시간 화면 확인 (Maestro Studio)

```bash
npm run test:e2e:studio
```

브라우저에서 GUI가 열리고 현재 시뮬레이터 화면을 실시간으로 보면서
시나리오를 작성하고 바로 실행할 수 있다.

---

## 스크린샷

테스트 실행 후 각 스텝의 스크린샷이 `e2e/screenshots/` 폴더에 저장된다.

---

## 플로우 목록

| 파일 | 설명 | 로그인 필요 |
|------|------|------------|
| `00_launch.yaml` | 앱 실행 + 로그인 화면 확인 | ❌ |
| `01_login_dev.yaml` | Dev 이메일 로그인 | ✅ (Dev 빌드) |
| `02_tab_navigation.yaml` | 4개 탭 이동 + 각 화면 확인 | ✅ |
| `03_event_create.yaml` | 이벤트 생성 플로우 | ✅ |
| `04_planner_todo.yaml` | 할일 생성 플로우 | ✅ |
| `05_golden_path.yaml` | 전체 골든 패스 (위 모두 합친 것) | ✅ (Dev 빌드) |

---

## Claude가 실행하는 방법

Claude Code가 테스트를 실행할 때:
```bash
# 시뮬레이터가 이미 실행 중이어야 함
maestro test e2e/flows/00_launch.yaml
```

결과는 터미널에 출력되고 스크린샷은 `e2e/screenshots/`에 저장된다.
사용자는 시뮬레이터 화면에서 실시간으로 테스트 진행을 확인할 수 있다.
