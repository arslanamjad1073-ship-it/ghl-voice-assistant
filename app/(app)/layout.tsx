import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { isAllowed } from '@/lib/auth';
import BottomNav from '@/components/BottomNav';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  if (!isAllowed(user.email)) redirect('/login?error=not_allowed');
  return (
    <div className="mx-auto min-h-dvh w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 sm:pt-10">
      {children}
      <BottomNav />
    </div>
  );
}
