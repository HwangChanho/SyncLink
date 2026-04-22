/**
 * @task TASK-902 (Sprint 9) — Event Realtime Service tests
 *
 * Tests for eventRealtimeService.subscribeToEvents — direct events-table
 * Realtime subscription added in TASK-902.
 * Supabase channel/removeChannel are mocked.
 */

import { supabase } from '@/lib/supabase';
import { subscribeToEvents } from '@/services/eventRealtimeService';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('@/lib/supabase', () => ({
  supabase: {
    channel:       jest.fn(),
    removeChannel: jest.fn(),
  },
  getCurrentUserId: jest.fn().mockResolvedValue('user-123'),
}));

jest.mock('@/services/eventService', () => ({
  getEventById: jest.fn(),
}));

// Mock only the AppState API used by subscribeToSharedEvents.
// Avoid spreading jest.requireActual('react-native') — it triggers native
// module loading (SettingsManager) that is unavailable in the Jest environment.
jest.mock('react-native', () => ({
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    currentState: 'active',
  },
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('eventRealtimeService — subscribeToEvents', () => {
  const SPACE_ID = 'space-xyz';

  /** Payload callback captured when .on() is called. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let capturedCallback: ((payload: any) => void) | undefined;

  /** A reusable channel mock that supports .on().subscribe() chaining. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let channelMock: { on: jest.Mock; subscribe: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    capturedCallback = undefined;

    // Re-build channel mock each test so capturedCallback is fresh
    channelMock = {
      on: jest.fn().mockImplementation((_type, _filter, cb) => {
        capturedCallback = cb;
        return channelMock;  // enable chaining: .on().subscribe()
      }),
      subscribe: jest.fn().mockReturnValue('channel-instance'),
    };

    (supabase.channel as jest.Mock).mockReturnValue(channelMock);
  });

  // ── Channel creation ───────────────────────────────────────────────────────

  it('creates a channel named events:space:<spaceId>', () => {
    subscribeToEvents(SPACE_ID, jest.fn(), jest.fn());

    expect(supabase.channel).toHaveBeenCalledWith(`events:space:${SPACE_ID}`);
  });

  it('subscribes to postgres_changes on the events table filtered by space_id', () => {
    subscribeToEvents(SPACE_ID, jest.fn(), jest.fn());

    expect(channelMock.on).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({
        schema: 'public',
        table:  'events',
        filter: `space_id=eq.${SPACE_ID}`,
      }),
      expect.any(Function),
    );
    expect(channelMock.subscribe).toHaveBeenCalledTimes(1);
  });

  // ── Callbacks ─────────────────────────────────────────────────────────────

  it('calls onUpsert with event ID on INSERT payload', () => {
    const onUpsert = jest.fn();

    subscribeToEvents(SPACE_ID, onUpsert, jest.fn());

    capturedCallback?.({ eventType: 'INSERT', new: { id: 'evt-1' }, old: {} });

    expect(onUpsert).toHaveBeenCalledWith('evt-1');
    expect(onUpsert).toHaveBeenCalledTimes(1);
  });

  it('calls onUpsert with event ID on UPDATE payload', () => {
    const onUpsert = jest.fn();

    subscribeToEvents(SPACE_ID, onUpsert, jest.fn());

    capturedCallback?.({ eventType: 'UPDATE', new: { id: 'evt-2' }, old: { id: 'evt-2' } });

    expect(onUpsert).toHaveBeenCalledWith('evt-2');
  });

  it('calls onDelete with event ID on DELETE payload', () => {
    const onDelete = jest.fn();

    subscribeToEvents(SPACE_ID, jest.fn(), onDelete);

    capturedCallback?.({ eventType: 'DELETE', new: {}, old: { id: 'evt-3' } });

    expect(onDelete).toHaveBeenCalledWith('evt-3');
  });

  it('does not call onDelete when DELETE payload has no old.id', () => {
    const onDelete = jest.fn();

    subscribeToEvents(SPACE_ID, jest.fn(), onDelete);

    capturedCallback?.({ eventType: 'DELETE', new: {}, old: {} });

    expect(onDelete).not.toHaveBeenCalled();
  });

  it('does not call onUpsert when new.id is absent on INSERT', () => {
    const onUpsert = jest.fn();

    subscribeToEvents(SPACE_ID, onUpsert, jest.fn());

    capturedCallback?.({ eventType: 'INSERT', new: {}, old: {} });

    expect(onUpsert).not.toHaveBeenCalled();
  });

  // ── Unsubscribe ────────────────────────────────────────────────────────────

  it('returns an unsubscribe function that calls supabase.removeChannel', () => {
    const unsubscribe = subscribeToEvents(SPACE_ID, jest.fn(), jest.fn());

    unsubscribe();

    expect(supabase.removeChannel).toHaveBeenCalledTimes(1);
  });
});
