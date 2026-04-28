/**
 * devConfig — development-only feature flags.
 *
 * This file is loaded via `require('@/constants/devConfig')` inside a
 * try/catch in WeekView so it is completely tree-shaken in production.
 * The module must NEVER be imported unconditionally from production code.
 *
 * Available flags:
 *
 * `dragMode`:
 *   'panresponder' — use the existing EventBlock PanResponder path.
 *   'gh'           — use EventBlockGestureHandler (TASK-009, long-press drag).
 *                    Long-press 500 ms → drag activates + haptic feedback.
 *                    Swipe conflicts resolved — matches iPhone Calendar UX.
 *
 * Default is now 'gh' so LEAD can test long-press drag immediately in dev
 * builds. Revert to 'panresponder' before creating a TestFlight build if
 * the feature is not yet ready for external testers.
 */
export const dragMode: 'panresponder' | 'gh' = 'gh';
