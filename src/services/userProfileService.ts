/**
 * userProfileService — v1.2.0 사용자 프로필 관련 작은 mutation 들.
 *
 * 현재는 country_code 변경만. 추후 nickname/avatar 변경 등도 여기로 모음.
 */

import { supabase, getCurrentUserId } from '@/lib/supabase';
import type { CountryCode } from '@/services/holidayService';

/** 현재 사용자의 country_code 갱신. authStore 도 같이 set 하는 게 권장. */
export async function setUserCountry(country: CountryCode): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('User is not authenticated.');
  const { error } = await (supabase as any)
    .from('users')
    .update({ country_code: country })
    .eq('id', userId);
  if (error) throw error;
}
