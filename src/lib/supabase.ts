/**
 * Supabase client initialization.
 *
 * This is the ONLY place where the Supabase client is created.
 * Services import this instance; components NEVER import it directly.
 *
 * Environment variables:
 *  - EXPO_PUBLIC_SUPABASE_URL: your Supabase project URL
 *  - EXPO_PUBLIC_SUPABASE_ANON_KEY: your public anon key (safe to expose)
 *
 * Note: EXPO_PUBLIC_ prefix makes vars available on the client bundle.
 * The service role key must NEVER appear here — Edge Functions only.
 *
 * ⚠️  BLOCKED: Requires .env to be filled in (see ESCALATION-001).
 */

import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Database } from '@/types';

// Validate required environment variables at startup
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Warn instead of throw — throwing at module level breaks test environments
  // that mock the client. Real connection attempts will still fail gracefully.
  // See: docs/escalations/ESCALATION-001.md for setup instructions.
  console.warn(
    '[SyncLink] Missing Supabase credentials.\n' +
    'Copy .env.example to .env and fill in EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.\n' +
    'See docs/escalations/ESCALATION-001.md for setup instructions.'
  );
}

/**
 * Typed Supabase client.
 *
 * The Database generic provides full type-safety for all table operations:
 *   const { data } = await supabase.from('events').select('*')
 *   // data is EventRow[] | null — fully typed
 */
export const supabase = createClient<Database>(supabaseUrl ?? '', supabaseAnonKey ?? '', {
  auth: {
    // Use AsyncStorage for session persistence on React Native
    storage: AsyncStorage,
    // Automatically refresh the session token
    autoRefreshToken: true,
    // Persist session across app restarts
    persistSession: true,
    // Detect session from URL (for OAuth redirects)
    detectSessionInUrl: false,
  },
});

/**
 * Helper to get the currently authenticated user ID.
 * Returns null if not logged in.
 */
export async function getCurrentUserId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}
