import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { isAllowed, displayName } from '@/lib/auth';
import BottomNav from '@/components/BottomNav';
import TopBar from '@/components/TopBar';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  if (!isAllowed(user.email)) redirect('/login?error=not_allowed');
  return (
    <div className="mx-auto min-h-dvh w-full max-w-6xl px-4 pb-28 pt-4 sm:px-6 sm:pt-6">
      <TopBar name={displayName(user)} email={user.email || ''} />
      {children}
      <BottomNav />
    </div>
  );
}
