import { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isSupabaseConfigured } from '../supabase.js';

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | undefined | null): boolean {
  if (!value) return false;
  return UUID_REGEX.test(value.trim());
}

/**
 * Execute a Supabase query safely.
 * Returns null immediately if Supabase is not configured or if an error occurs,
 * allowing instant, graceful fallback to the local SQLite storage engine.
 */
export async function safeSupabase<T>(
  queryFn: (client: SupabaseClient) => Promise<{ data: T | null; error: any }>
): Promise<T | null> {
  const client = getSupabaseClient();
  if (!client || !isSupabaseConfigured()) {
    return null;
  }

  try {
    const { data, error } = await queryFn(client);
    if (error) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}
