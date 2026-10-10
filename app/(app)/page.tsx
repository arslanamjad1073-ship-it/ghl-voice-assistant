import { currentUser, displayName } from '@/lib/auth';
import HomeView from '@/components/HomeView';

export default async function HomePage() {
  const user = await currentUser();
  return <HomeView name={user ? displayName(user) : 'there'} email={user?.email || ''} />;
}
