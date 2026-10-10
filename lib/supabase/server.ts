import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

// Supabase client bound to the signed-in user's cookies (auth only)
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component: the middleware refreshes the session instead
        }
      }
    }
  });
}
