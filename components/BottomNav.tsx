'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSubaccounts } from '@/lib/useSubaccounts';
import { IconHome, IconMic, IconClock, IconBuilding, IconUsers } from '@/components/Icons';

const ITEMS = [
  { href: '/', label: 'Home', Icon: IconHome },
  { href: '/talk', label: 'Talk', Icon: IconMic },
  { href: '/leads', label: 'Leads', Icon: IconUsers },
  { href: '/history', label: 'History', Icon: IconClock },
  { href: '/subaccounts', label: 'Accounts', Icon: IconBuilding }
];

// Floating pill nav: the active item expands with its label (as in the reference)
export default function BottomNav() {
  const path = usePathname();
  const sa = useSubaccounts();
  if (path === '/talk') return null; // the call screen has its own controls
  const items = ITEMS.filter((i) => i.href !== '/talk' || sa.current?.voice_enabled);
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 pb-[env(safe-area-inset-bottom)]">
      <ul className="flex items-center gap-1 rounded-full sm:gap-1.5 border border-line bg-panel/90 p-1.5 shadow-2xl shadow-black/50 backdrop-blur">
        {items.map(({ href, label, Icon }) => {
          const active = href === '/' ? path === '/' : path.startsWith(href);
          return (
            <li key={href}>
              <Link href={href} aria-label={label} aria-current={active ? 'page' : undefined}
                className={`flex h-11 items-center gap-2 rounded-full transition-colors sm:h-12 ${
                  active ? 'bg-card-2 px-4 text-fg sm:px-5' : 'w-11 justify-center text-muted hover:bg-card hover:text-fg sm:w-12'
                }`}>
                <Icon size={21} />
                {active && <span className="text-[15px] font-medium">{label}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
