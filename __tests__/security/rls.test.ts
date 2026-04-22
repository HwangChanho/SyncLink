/**
 * __tests__/security/rls.test.ts
 *
 * TASK-911: RLS (Row Level Security) Policy Simulation Tests
 *
 * MOCK-BASED TEST:
 *   This file simulates Supabase RLS policies as pure TypeScript functions
 *   mirroring the SQL policy logic in 002_rls_policies.sql / 005_push_tokens.sql.
 *   It does NOT connect to a real Supabase instance.
 *
 *   For production verification against a live DB, run the same scenarios with:
 *     - supabase start (local emulator) + service role key, or
 *     - a dedicated Supabase test project with anon key JWT per user.
 *
 * Coverage: 7 tables × 4+ cases = 30 test cases
 *   Tables: users, spaces, space_members, events, event_shares, todos, notification_logs
 *
 * Policy sources:
 *   supabase/migrations/002_rls_policies.sql  — users through todos
 *   supabase/migrations/005_push_tokens.sql   — notification_logs
 */

// ─── Row Type Definitions (mirrors DB schema) ─────────────────────────────────

interface UserRow {
  id: string;
  email: string;
  nickname: string;
}

interface SpaceRow {
  id: string;
  name: string;
  created_by: string;
}

type MemberRole = 'owner' | 'member';

interface SpaceMemberRow {
  id: string;
  space_id: string;
  user_id: string;
  role: MemberRole;
}

interface EventRow {
  id: string;
  user_id: string;
  title: string;
}

interface EventShareRow {
  id: string;
  event_id: string;
  space_id: string;
}

interface TodoRow {
  id: string;
  user_id: string;
  space_id: string | null;
  title: string;
}

interface NotificationLogRow {
  id: string;
  user_id: string;
  notification_type: string;
}

// ─── Test Fixture IDs ─────────────────────────────────────────────────────────

const USER_A = 'user-a-uuid';
const USER_B = 'user-b-uuid';
const USER_C = 'user-c-uuid'; // stranger — shares no space with A or B

const SPACE_AB      = 'space-ab-uuid';      // A (owner) + B (member)
const SPACE_A_ONLY  = 'space-a-only-uuid';  // A only

const EVENT_A_PRIVATE = 'event-a-private-uuid'; // not shared to any space
const EVENT_A_SHARED  = 'event-a-shared-uuid';  // shared to SPACE_AB

const TODO_A_PRIVATE = 'todo-a-private-uuid'; // space_id = null
const TODO_A_SHARED  = 'todo-a-shared-uuid';  // space_id = SPACE_AB

const NOTIF_A = 'notif-a-uuid';

// ─── In-Memory Database Fixture ───────────────────────────────────────────────

const db = {
  users: [
    { id: USER_A, email: 'a@test.com', nickname: 'UserA' },
    { id: USER_B, email: 'b@test.com', nickname: 'UserB' },
    { id: USER_C, email: 'c@test.com', nickname: 'UserC' },
  ] as UserRow[],

  spaces: [
    { id: SPACE_AB,     name: 'Space AB',     created_by: USER_A },
    { id: SPACE_A_ONLY, name: 'Space A Only', created_by: USER_A },
  ] as SpaceRow[],

  space_members: [
    { id: 'sm-1', space_id: SPACE_AB,     user_id: USER_A, role: 'owner'  as MemberRole },
    { id: 'sm-2', space_id: SPACE_AB,     user_id: USER_B, role: 'member' as MemberRole },
    { id: 'sm-3', space_id: SPACE_A_ONLY, user_id: USER_A, role: 'owner'  as MemberRole },
  ] as SpaceMemberRow[],

  events: [
    { id: EVENT_A_PRIVATE, user_id: USER_A, title: 'Private Event' },
    { id: EVENT_A_SHARED,  user_id: USER_A, title: 'Shared Event'  },
  ] as EventRow[],

  event_shares: [
    { id: 'es-1', event_id: EVENT_A_SHARED, space_id: SPACE_AB },
  ] as EventShareRow[],

  todos: [
    { id: TODO_A_PRIVATE, user_id: USER_A, space_id: null,     title: 'Private Todo' },
    { id: TODO_A_SHARED,  user_id: USER_A, space_id: SPACE_AB, title: 'Shared Todo'  },
  ] as TodoRow[],

  notification_logs: [
    { id: NOTIF_A, user_id: USER_A, notification_type: 'reminder' },
  ] as NotificationLogRow[],
};

// ─── RLS Policy Simulation — pure functions mirroring SQL policies ────────────

/**
 * Returns space IDs that a user belongs to.
 * Used as a building block for multiple policies.
 */
function getMySpaceIds(userId: string): string[] {
  return db.space_members
    .filter(sm => sm.user_id === userId)
    .map(sm => sm.space_id);
}

/**
 * Mirrors the get_space_member_ids(p_user_id) SECURITY DEFINER SQL function
 * (002_rls_policies.sql:33). Returns all user_ids sharing at least one space
 * with p_user_id.
 */
function getSpaceMemberIds(userId: string): string[] {
  const mySpaceIds = getMySpaceIds(userId);
  return db.space_members
    .filter(sm => mySpaceIds.includes(sm.space_id))
    .map(sm => sm.user_id);
}

// --- users ---

/**
 * Policy: users_select_own + users_select_space_members
 * Own profile OR profiles of users sharing a space.
 */
function users_select(authUid: string): UserRow[] {
  const memberIds = getSpaceMemberIds(authUid);
  return db.users.filter(u => u.id === authUid || memberIds.includes(u.id));
}

/**
 * Policy: users_update_own — auth.uid() = id
 */
function users_canUpdate(authUid: string, targetId: string): boolean {
  return authUid === targetId;
}

// --- spaces ---

/**
 * Policy: spaces_select_member
 * Visible only if user is in space_members for that space.
 */
function spaces_select(authUid: string): SpaceRow[] {
  const mySpaceIds = getMySpaceIds(authUid);
  return db.spaces.filter(s => mySpaceIds.includes(s.id));
}

/**
 * Policy: spaces_insert_authenticated — created_by = auth.uid()
 */
function spaces_canInsert(authUid: string, row: Pick<SpaceRow, 'created_by'>): boolean {
  return authUid === row.created_by;
}

/**
 * Policy: spaces_update_owner / spaces_delete_owner — must be owner in space_members
 */
function spaces_canModifyOrDelete(authUid: string, spaceId: string): boolean {
  return db.space_members.some(
    sm => sm.space_id === spaceId && sm.user_id === authUid && sm.role === 'owner'
  );
}

// --- space_members ---

/**
 * Policy: space_members_select_own_spaces
 * Can see rows where their own membership shares the same space_id.
 */
function space_members_select(authUid: string): SpaceMemberRow[] {
  const mySpaceIds = getMySpaceIds(authUid);
  return db.space_members.filter(sm => mySpaceIds.includes(sm.space_id));
}

/**
 * Policy: space_members_insert_self — user_id = auth.uid()
 */
function space_members_canInsert(authUid: string, row: Pick<SpaceMemberRow, 'user_id'>): boolean {
  return authUid === row.user_id;
}

/**
 * Policy: space_members_update / space_members_delete
 * Own membership OR owner of the space.
 */
function space_members_canModify(authUid: string, target: SpaceMemberRow): boolean {
  return authUid === target.user_id ||
    db.space_members.some(
      sm => sm.space_id === target.space_id && sm.user_id === authUid && sm.role === 'owner'
    );
}

// --- events ---

/**
 * Policy: events_select_own + events_select_shared
 * Own events OR events shared to one of my spaces.
 */
function events_select(authUid: string): EventRow[] {
  const mySpaceIds = getMySpaceIds(authUid);
  return db.events.filter(e =>
    e.user_id === authUid ||
    db.event_shares.some(es => es.event_id === e.id && mySpaceIds.includes(es.space_id))
  );
}

/**
 * Policy: events_insert_own — user_id = auth.uid()
 */
function events_canInsert(authUid: string, row: Pick<EventRow, 'user_id'>): boolean {
  return authUid === row.user_id;
}

/**
 * Policy: events_update_own / events_delete_own — must own the event
 */
function events_canModify(authUid: string, eventId: string): boolean {
  return db.events.some(e => e.id === eventId && e.user_id === authUid);
}

// --- event_shares ---

/**
 * Policy: event_shares_select
 * Own event OR member of the target space.
 */
function event_shares_select(authUid: string): EventShareRow[] {
  const mySpaceIds = getMySpaceIds(authUid);
  return db.event_shares.filter(es =>
    db.events.some(e => e.id === es.event_id && e.user_id === authUid) ||
    mySpaceIds.includes(es.space_id)
  );
}

/**
 * Policy: event_shares_insert_owner — must own the event
 */
function event_shares_canInsert(authUid: string, row: Pick<EventShareRow, 'event_id'>): boolean {
  return db.events.some(e => e.id === row.event_id && e.user_id === authUid);
}

/**
 * Policy: event_shares_delete_owner — must own the event
 */
function event_shares_canDelete(authUid: string, shareId: string): boolean {
  const share = db.event_shares.find(es => es.id === shareId);
  if (!share) return false;
  return db.events.some(e => e.id === share.event_id && e.user_id === authUid);
}

// --- todos ---

/**
 * Policy: todos_select_own + todos_select_shared
 * Own todos OR todos in a space the user belongs to (space_id not null).
 */
function todos_select(authUid: string): TodoRow[] {
  const mySpaceIds = getMySpaceIds(authUid);
  return db.todos.filter(t =>
    t.user_id === authUid ||
    (t.space_id !== null && mySpaceIds.includes(t.space_id))
  );
}

/**
 * Policy: todos_insert_own — user_id = auth.uid()
 */
function todos_canInsert(authUid: string, row: Pick<TodoRow, 'user_id'>): boolean {
  return authUid === row.user_id;
}

/**
 * Policy: todos_update_own / todos_delete_own — must own the todo
 */
function todos_canModify(authUid: string, todoId: string): boolean {
  return db.todos.some(t => t.id === todoId && t.user_id === authUid);
}

// --- notification_logs ---

/**
 * Policy: notification_logs_select_own — auth.uid() = user_id
 * (INSERT is Edge Function only via service role — not tested here)
 */
function notification_logs_select(authUid: string): NotificationLogRow[] {
  return db.notification_logs.filter(n => n.user_id === authUid);
}

// ─── Test Suites ──────────────────────────────────────────────────────────────

describe('RLS Policy Simulation (mock-based) — 7 tables, 30 cases', () => {

  // ─── users ───────────────────────────────────────────────────────────────

  describe('users table', () => {
    it('case 1: SELECT — userA can read own profile', () => {
      const result = users_select(USER_A);
      expect(result.some(u => u.id === USER_A)).toBe(true);
    });

    it('case 2: SELECT — userC (stranger) cannot read userA profile', () => {
      // USER_C shares no space with USER_A
      const result = users_select(USER_C);
      expect(result.some(u => u.id === USER_A)).toBe(false);
    });

    it('case 3: SELECT — userB can read userA profile via shared space AB', () => {
      // Mirrors users_select_space_members policy (SECURITY DEFINER function)
      const result = users_select(USER_B);
      expect(result.some(u => u.id === USER_A)).toBe(true);
    });

    it('case 4: UPDATE — userB cannot update userA profile', () => {
      expect(users_canUpdate(USER_B, USER_A)).toBe(false);
    });
  });

  // ─── spaces ──────────────────────────────────────────────────────────────

  describe('spaces table', () => {
    it('case 5: SELECT — userA (member) can read space AB', () => {
      const result = spaces_select(USER_A);
      expect(result.some(s => s.id === SPACE_AB)).toBe(true);
    });

    it('case 6: SELECT — userC (non-member) cannot read space AB', () => {
      const result = spaces_select(USER_C);
      expect(result.some(s => s.id === SPACE_AB)).toBe(false);
    });

    it('case 7: INSERT — user can create a space with created_by = own ID', () => {
      expect(spaces_canInsert(USER_A, { created_by: USER_A })).toBe(true);
    });

    it('case 8: UPDATE — non-owner (userB) cannot modify space AB', () => {
      // userB is 'member', not 'owner' in SPACE_AB
      expect(spaces_canModifyOrDelete(USER_B, SPACE_AB)).toBe(false);
    });
  });

  // ─── space_members ────────────────────────────────────────────────────────

  describe('space_members table', () => {
    it('case 9: SELECT — userA can read members of space AB (is a member)', () => {
      const result = space_members_select(USER_A);
      expect(result.some(sm => sm.space_id === SPACE_AB)).toBe(true);
    });

    it('case 10: SELECT — userC cannot read members of space AB (not a member)', () => {
      const result = space_members_select(USER_C);
      expect(result.some(sm => sm.space_id === SPACE_AB)).toBe(false);
    });

    it('case 11: INSERT — user can add themselves to a space', () => {
      expect(space_members_canInsert(USER_C, { user_id: USER_C })).toBe(true);
    });

    it('case 12: INSERT — user cannot add another user to a space', () => {
      // userB cannot insert a membership row where user_id = USER_A
      expect(space_members_canInsert(USER_B, { user_id: USER_A })).toBe(false);
    });
  });

  // ─── events ──────────────────────────────────────────────────────────────

  describe('events table', () => {
    it('case 13: SELECT — userA can read own private event', () => {
      const result = events_select(USER_A);
      expect(result.some(e => e.id === EVENT_A_PRIVATE)).toBe(true);
    });

    it('case 14: SELECT — userB cannot read userA private event (not shared)', () => {
      const result = events_select(USER_B);
      expect(result.some(e => e.id === EVENT_A_PRIVATE)).toBe(false);
    });

    it('case 15: UPDATE — userA can update own event', () => {
      expect(events_canModify(USER_A, EVENT_A_PRIVATE)).toBe(true);
    });

    it('case 16: DELETE — userB cannot delete userA event', () => {
      expect(events_canModify(USER_B, EVENT_A_PRIVATE)).toBe(false);
    });
  });

  // ─── event_shares ─────────────────────────────────────────────────────────
  //
  // Includes the two space-sharing relationship cases from TASK-911:
  //   Case 18: space-sharing allows access (허용)
  //   Case 19: no space relationship → blocked (차단)

  describe('event_shares table', () => {
    it('case 17: SELECT — event owner (userA) can read own event_shares', () => {
      const result = event_shares_select(USER_A);
      expect(result.some(es => es.event_id === EVENT_A_SHARED)).toBe(true);
    });

    it('case 18: SELECT — space member (userB in space AB) can read shared event_shares', () => {
      // Space-sharing relationship → allowed (policy: space member access)
      const result = event_shares_select(USER_B);
      expect(result.some(es => es.event_id === EVENT_A_SHARED)).toBe(true);
    });

    it('case 19: SELECT — stranger (userC) cannot read event_shares (not owner, not member)', () => {
      // No space-sharing relationship → blocked
      const result = event_shares_select(USER_C);
      expect(result.some(es => es.event_id === EVENT_A_SHARED)).toBe(false);
    });

    it('case 20: INSERT — event owner (userA) can create an event_share', () => {
      expect(event_shares_canInsert(USER_A, { event_id: EVENT_A_PRIVATE })).toBe(true);
    });

    it('case 21: INSERT — non-owner (userB) cannot share userA event', () => {
      expect(event_shares_canInsert(USER_B, { event_id: EVENT_A_PRIVATE })).toBe(false);
    });

    it('case 22: DELETE — non-owner (userB) cannot delete event_share', () => {
      expect(event_shares_canDelete(USER_B, 'es-1')).toBe(false);
    });
  });

  // ─── todos ────────────────────────────────────────────────────────────────

  describe('todos table', () => {
    it('case 23: SELECT — userA can read own private todo', () => {
      const result = todos_select(USER_A);
      expect(result.some(t => t.id === TODO_A_PRIVATE)).toBe(true);
    });

    it('case 24: SELECT — userB cannot read userA private todo (space_id = null)', () => {
      // Private todo (space_id = null) → not visible to space members
      const result = todos_select(USER_B);
      expect(result.some(t => t.id === TODO_A_PRIVATE)).toBe(false);
    });

    it('case 25: SELECT — userB can read userA shared todo (space_id = space AB)', () => {
      // todos_select_shared policy: space_id not null AND space member
      const result = todos_select(USER_B);
      expect(result.some(t => t.id === TODO_A_SHARED)).toBe(true);
    });

    it('case 26: INSERT — userA can insert own todo', () => {
      expect(todos_canInsert(USER_A, { user_id: USER_A })).toBe(true);
    });

    it('case 27: UPDATE — userB cannot update userA todo', () => {
      expect(todos_canModify(USER_B, TODO_A_PRIVATE)).toBe(false);
    });

    it('case 28: DELETE — userC cannot delete userA shared todo', () => {
      // Ownership check (user_id) blocks even if no space relation
      expect(todos_canModify(USER_C, TODO_A_SHARED)).toBe(false);
    });
  });

  // ─── notification_logs ────────────────────────────────────────────────────

  describe('notification_logs table', () => {
    it('case 29: SELECT — userA can read own notification_logs', () => {
      const result = notification_logs_select(USER_A);
      expect(result.some(n => n.id === NOTIF_A)).toBe(true);
    });

    it('case 30: SELECT — userB cannot read userA notification_logs', () => {
      const result = notification_logs_select(USER_B);
      expect(result.some(n => n.id === NOTIF_A)).toBe(false);
    });
  });
});
