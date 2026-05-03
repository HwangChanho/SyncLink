/**
 * space/index — Phase 2.3 도메인 분할 후의 barrel re-export.
 *
 * spaceService.ts 가 이 디렉토리로 모듈화됐다 (1,039줄 → 4개 도메인 파일).
 * 기존 import 경로 (`@/services/spaceService`) 는 그대로 유효 — 그 파일도
 * 이 barrel 만 re-export 하므로 호출부 변경 0.
 */

export * from './crud';
export * from './joinCodes';
export * from './members';
export * from './anniversaries';
