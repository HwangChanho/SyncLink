# SyncLink Auto-Reviewer

자율 셀프-리뷰 시스템. 사용자 입력 없이 매일 코드/이슈/비용을 점검하고 결과를 `docs/inbox/`에 쌓는다.

> 설계 전체: [`docs/architecture/AUTO_REVIEW.md`](../../docs/architecture/AUTO_REVIEW.md)
> 사용자 정책: [`docs/AUTONOMY.md`](../../docs/AUTONOMY.md)

---

## 빠른 시작 (LEAD 일회성)

```bash
# 1. Claude CLI 설치 (안 깔려있다면)
brew install anthropics/claude/claude
claude login   # OAuth 로그인 → 토큰 저장

# 2. 첫 dry-run으로 prompt 검증
bash scripts/auto-review/run.sh daily-review --dry-run

# 3. LaunchAgent 등록 (매일 자동 실행 시작)
bash scripts/auto-review/install.sh

# 4. 활성화 확인
launchctl list | grep synclink
tail -f ~/Library/Logs/synclink-auto-review.log
```

---

## 매일 실행되는 작업

| Label | 시각 (KST) | 작업 |
|-------|------------|------|
| `io.synclink.autoreview.daily`  | 03:00 | git diff + 코드 health 리뷰 |
| `io.synclink.autoreview.triage` | 04:00 | 이슈 우선순위 + 중복/stale |
| `io.synclink.autoreview.cost`   | 09:00 | API/Supabase 비용 + 임계 알림 |

결과는 모두 `docs/inbox/<TYPE>_<DATE>.md`에 저장. LEAD는 다음 세션 시작 시 inbox만 5분 정독하면 됨.

---

## 수동 실행

```bash
# 단일 작업 즉시 실행
bash scripts/auto-review/run.sh daily-review
bash scripts/auto-review/run.sh test-fix --dry-run
bash scripts/auto-review/run.sh cost-monitor
bash scripts/auto-review/run.sh issue-triage

# 모든 작업을 차례로
for p in daily-review issue-triage cost-monitor; do
  bash scripts/auto-review/run.sh "$p"
done
```

---

## Kill switch

이상한 동작 발견 즉시:

```bash
touch .auto-review-disabled
```

다음 LaunchAgent 트리거가 `guard_kill_switch`에서 즉시 종료. 영구 차단하려면:

```bash
launchctl unload ~/Library/LaunchAgents/io.synclink.autoreview.*.plist
rm ~/Library/LaunchAgents/io.synclink.autoreview.*.plist
```

---

## 안전 가드

`scripts/auto-review/guardrails.sh`에서 매 실행 전후로:

| Guard | 시점 | 차단 사유 |
|-------|------|----------|
| `guard_kill_switch`        | 사전 | `.auto-review-disabled` 존재 |
| `guard_call_cap`           | 사전 | 일일 5회 초과 |
| `guard_output_sanity`      | 사후 | `.env`/`credentials/` 변경, 위험 패턴 detect |
| `guard_surface_escalation` | 사후 | `docs/escalations/` 새 파일 |

위험 패턴 (자동 거부):
- `git push --force` / `git reset --hard` / `rm -rf /`
- `DROP TABLE` / `DELETE FROM users` / `DELETE FROM auth.*`
- `service_role.*JWT` / `AuthKey_*.p8`

위반 시 자동 `git checkout -- .` 또는 `git revert`.

---

## 비용

설계 추정 (Claude Haiku 4.5 기본):
- 일상 cron 4회 × 7K 토큰 ≈ **$0.20/일** = **~$6/월**
- test-fix Sonnet 4.6 (간헐적): **~$3/월**
- 합계: **~$9/월**

상한 도달 (월 $25) 시 cost-monitor가 자동 ESCALATION.

---

## 디렉토리

```
scripts/auto-review/
├ README.md            ← 이 파일
├ run.sh               ← entry, prompt 선택, claude CLI 호출
├ guardrails.sh        ← 사전/사후 안전 검사
├ install.sh           ← LaunchAgent 등록 (idempotent)
├ launchagents/
│  ├ io.synclink.autoreview.daily.plist
│  ├ io.synclink.autoreview.triage.plist
│  └ io.synclink.autoreview.cost.plist
└ prompts/
   ├ daily-review.md   ← git diff + 코드 health 리뷰
   ├ test-fix.md       ← 단순 회귀 자동 fix + 나머지는 issue 발급
   ├ cost-monitor.md   ← 비용 일일 트래킹
   └ issue-triage.md   ← 이슈 우선순위/중복/stale
```

---

## 결과 검토 흐름

LEAD 매일 5~10분 루틴:

```
1. 새 세션 시작
2. ls docs/inbox/  (어제 결과물 확인)
3. cat docs/inbox/REVIEW_<오늘>.md  (5분 정독)
4. cat docs/inbox/TRIAGE_<오늘>.md  (우선순위 조정)
5. (있다면) git log --since='1 day ago' chore(auto-fix) 검토 → 머지 or revert
6. (있다면) docs/escalations/ 새 파일 즉시 처리
```

---

## 개선 아이디어 (Phase 2+)

- Self-tuning: LEAD가 매주 결과 0~3 평가 → prompt 자동 튜닝
- Multi-agent: daily-review 결과 → specialist 분기 (DB / UI / 보안)
- Cross-project: 다른 프로젝트도 동일 시스템 재사용
- GitHub Actions 통합: push 시 즉시 리뷰 (Mac 안 켜져있어도)
