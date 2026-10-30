import { signedInUser } from '@/lib/access';
import { displayName } from '@/lib/auth';
import HomeView from '@/components/HomeView';

export default async function HomePage() {
  const user = await signedInUser();
  return <HomeView name={user ? displayName(user) : 'there'} email={user?.email || ''} />;
}
