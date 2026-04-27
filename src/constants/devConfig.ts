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
 *   'panresponder' (default) — use the existing EventBlock PanResponder path.
 *   'gh'                     — use EventBlockGestureHandler (TASK-009 PoC).
 *
 * To activate the GH drag PoC:
 *   Change `dragMode` below to 'gh' and restart Metro.
 *   Remember to revert before creating a TestFlight build.
 */
export const dragMode: 'panresponder' | 'gh' = 'panresponder';
