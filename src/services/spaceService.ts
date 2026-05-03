/**
 * spaceService — Phase 2.3 분할 후 호환 barrel.
 *
 * 실제 구현은 `src/services/space/` 디렉토리의 도메인별 모듈로 옮겨졌다:
 *  - crud.ts          (Space 자체 CRUD + 커버 업로드)
 *  - joinCodes.ts     (초대 코드 발급/검증/소비 + ID join)
 *  - members.ts       (탈퇴/소유권 이전/강퇴/색 변경)
 *  - anniversaries.ts (기념일 / D-day)
 *  - _internals.ts    (private helpers — supa client / row→domain mapper)
 *
 * 기존 호출부 호환을 위해 모든 export 를 그대로 re-export 한다.
 * 새 코드는 `@/services/space` 또는 `@/services/space/<도메인>` 직접
 * import 가 더 명확하지만, 점진적 마이그레이션을 위해 이 파일은 유지.
 */

export * from './space';
