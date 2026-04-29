/**
 * devConfig — development-only feature flags.
 *
 * Intentionally minimal. Drag-to-reschedule is no longer behind a flag —
 * RNGH (EventBlockGestureHandler) is the single canonical implementation
 * across all builds. EventBlock is a pure display component.
 *
 * Add new flags here only when an A/B path needs to ship behind a guard.
 */
export {};
