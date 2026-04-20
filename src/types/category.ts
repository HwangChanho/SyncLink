/**
 * Category domain types.
 *
 * Categories are used for both events and todos.
 * System categories (userId = null) are predefined and cannot be modified.
 * User categories (userId = string) are user-defined.
 */

// ─── Core domain type ─────────────────────────────────────────────────────────

export interface Category {
  id: string;
  /** null = system default category (개인/업무/기타); non-null = user-defined. */
  userId: string | null;
  name: string;
  /** Hex color string, e.g. '#4A90E2'. */
  color: string;
  /** Optional icon name (e.g. 'person', 'briefcase', 'tag'). */
  icon: string | null;
  createdAt: Date;
}

// ─── Input types ─────────────────────────────────────────────────────────────

export interface CreateCategoryInput {
  name: string;
  color: string;
  icon?: string;
}

export type UpdateCategoryInput = Partial<CreateCategoryInput>;
