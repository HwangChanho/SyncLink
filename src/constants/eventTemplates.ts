/**
 * Predefined "quick add" event templates shown on the AI assistant empty
 * state (QuickAddSuggestions). Tapping one routes to the create form with the
 * label pre-filled as the title plus a best-fit system category.
 *
 * The app only ships three seeded system categories (개인/업무/기타), so every
 * template maps onto one of them via `builtin`. The concrete categoryId is
 * resolved at runtime by categoryService.getBuiltinCategoryMap().
 */

/** The three seeded system categories, keyed by a stable builtin name. */
export type BuiltinSystemCategory = 'personal' | 'work' | 'other';

export interface QuickAddTemplate {
  /** Stable key — also the i18n label key under `nl.quickAdd.<key>`. */
  key: string;
  /** Which system category this template prefills. */
  builtin: BuiltinSystemCategory;
}

/**
 * Default category templates (LEAD-confirmed 2026-06-28).
 * Order = display order. Meetings/deadlines map to 업무(work); the rest to
 * 개인(personal) since the app has no finer-grained system categories.
 */
export const QUICK_ADD_TEMPLATES: QuickAddTemplate[] = [
  { key: 'meeting',     builtin: 'work' },
  { key: 'deadline',    builtin: 'work' },
  { key: 'appointment', builtin: 'personal' },
  { key: 'meal',        builtin: 'personal' },
  { key: 'workout',     builtin: 'personal' },
  { key: 'hospital',    builtin: 'personal' },
  { key: 'travel',      builtin: 'personal' },
  { key: 'date',        builtin: 'personal' },
];
