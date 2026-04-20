# SyncDay

AI-powered schedule sharing app. Built with autonomous Claude Code agents.

## 자율 에이전트 시스템

이 프로젝트는 3개의 Claude Code 에이전트(LEAD/DEV/QA)가 자율적으로 협업합니다.

### 자율성 레벨
- **Level 1**: 완전 자율 (일상 작업)
- **Level 2**: 에이전트 간 peer review (아키텍처 변경 등)
- **Level 3**: 진행하되 알림 (계획 조정 등)
- **Level 4**: 사람 승인 필수 (비용, 보안, 배포)

자세한 규칙은 `docs/AUTONOMY.md` 참조.

## 시작하기

### 1. 프로젝트 위치로 이동
```bash
cd ~/projects/syncday
```

### 2. 에이전트 시작 (tmux 병렬)
```bash
tmux new-session -s syncday
tmux split-window -h
tmux split-window -v
```

3개 pane 각각에서 Claude Code 실행 후:
- Pane 0 (LEAD): `.claude/agents/lead.md`를 시스템 프롬프트로 설정
- Pane 1 (DEV): `.claude/agents/dev.md`를 시스템 프롬프트로 설정
- Pane 2 (QA): `.claude/agents/qa.md`를 시스템 프롬프트로 설정

### 3. 첫 명령
LEAD에게 이렇게 지시:
```
docs/AUTONOMY.md, docs/PROTOCOL.md, docs/PRD.md, docs/SPRINT_PLAN.md를 읽고
Sprint 0의 태스크를 docs/tasks/sprint-0.md로 작성해. 이후 자율 모드로 진행해.
Level 4 상황이 오면 docs/escalations/에 질문 파일을 만들어두고 대기해.
```

DEV와 QA에게도 비슷하게:
```
.claude/agents/{dev|qa}.md를 시스템 프롬프트로 사용해.
docs/AUTONOMY.md와 docs/PROTOCOL.md를 읽고 자율 모드로 대기해.
LEAD가 sprint-0.md를 만들면 자동으로 작업 시작해.
```

## 사람(user) 개입이 필요한 순간

`docs/escalations/` 에 새 파일이 생기면 에이전트가 막힌 상황입니다.
파일을 읽고 답변을 작성한 후, Status를 Answered로 바꾸면 에이전트가 재개합니다.

`docs/decisions/` 에는 Level 3 알림이 쌓입니다. 여유가 있을 때 훑어보세요.

## 폴더 구조

```
syncday/
├── CLAUDE.md                # 자동 로드 공통 컨텍스트
├── .claude/agents/          # 에이전트별 시스템 프롬프트
│   ├── lead.md
│   ├── dev.md
│   └── qa.md
└── docs/
    ├── AUTONOMY.md          # 자율성 레벨 정의
    ├── PROTOCOL.md          # 소통 프로토콜
    ├── RETROSPECTIVE.md     # 자기 개선 방식
    ├── PRD.md               # 제품 요구사항
    ├── SPRINT_PLAN.md       # 스프린트 계획
    ├── AGENTS.md            # 팀 구조
    ├── tasks/               # 태스크 (LEAD 생성)
    ├── issues/              # 버그 (QA 생성)
    ├── proposals/           # Level 2 제안
    ├── decisions/           # Level 3 알림 + ADR 참조
    ├── escalations/         # Level 4 사람 대기
    ├── architecture/
    │   └── DECISIONS.md     # ADR 누적 로그
    ├── retrospectives/      # 스프린트 회고
    └── review/              # QA 스프린트 리뷰
```
