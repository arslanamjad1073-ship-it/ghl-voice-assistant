import { redirect } from 'next/navigation';
import { signedInUser, getAccess } from '@/lib/access';
import { displayName } from '@/lib/auth';
import { AccessProvider } from '@/components/AccessProvider';
import BottomNav from '@/components/BottomNav';
import TopBar from '@/components/TopBar';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await signedInUser();
  if (!user) redirect('/login');
  const access = await getAccess();
  if (!access) redirect('/welcome'); // signed in but not (or no longer) in an organization
  const { orgId, orgName, role, permissions, allSubaccounts } = access;
  return (
    <AccessProvider value={{ orgId, orgName, role, permissions, allSubaccounts }}>
      <div className="mx-auto min-h-dvh w-full max-w-6xl px-4 pb-28 pt-4 sm:px-6 sm:pt-6">
        <TopBar name={displayName(user)} email={user.email || ''} />
        {children}
        <BottomNav />
      </div>
    </AccessProvider>
  );
}
