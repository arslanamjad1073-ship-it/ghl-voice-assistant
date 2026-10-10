import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Service-role client for the app's tables. Server only: it bypasses RLS.
let admin: SupabaseClient | null = null;
export function supabaseAdmin() {
  if (!admin) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return admin;
}
