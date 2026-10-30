'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import NotificationCenter from '@/components/NotificationCenter';
import { useAccess } from '@/components/AccessProvider';
import { ROLE_LABEL } from '@/lib/permissions';
import { IconLogout, IconSparkle, IconShield } from '@/components/Icons';

export default function TopBar({ name, email }: { name: string; email: string }) {
  const path = usePathname();
  const access = useAccess();
  const [menu, setMenu] = useState(false);
  if (path === '/talk') return null; // the call screen has its own header
  const showAi = access.can('manage_ai') || access.can('view_usage');
  const showTeam = access.can('manage_team');
  const pill = (active: boolean) => `inline-flex h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition sm:px-4 ${active ? 'bg-cyan text-cyan-ink' : 'bg-card text-fg hover:bg-card-2'}`;
  return (
    <div className="mb-6 flex items-center justify-between gap-3">
      <Link href="/" className="min-w-0 text-[15px] font-semibold tracking-tight">
        <span className="text-cyan">Flow</span>minds <span className="font-normal text-muted">· Nova</span>
        {access.orgName && <span className="mt-0.5 block truncate text-xs font-normal text-faint">{access.orgName}</span>}
      </Link>
      <div className="relative flex shrink-0 items-center gap-2">
        {showTeam && (
          <Link href="/team" aria-label="Team & permissions" title="Team & permissions" className={pill(path.startsWith('/team'))}>
            <IconShield size={17} /><span className="hidden sm:inline">Team</span>
          </Link>
        )}
        {showAi && (
          <Link href="/settings/ai" aria-label="AI keys & usage" title="AI keys & usage" className={pill(path.startsWith('/settings/ai'))}>
            <IconSparkle size={17} /><span className="hidden sm:inline">{access.can('manage_ai') ? 'AI keys' : 'AI usage'}</span>
          </Link>
        )}
        <NotificationCenter />
        <button onClick={() => setMenu((m) => !m)} aria-label="Account" aria-expanded={menu}
          className="flex size-11 items-center justify-center rounded-full bg-card text-sm font-semibold text-cyan hover:bg-card-2">
          {name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
        </button>
        {menu && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
            <div className="absolute right-0 top-13 z-40 w-64 rounded-2xl border border-line bg-panel p-2 shadow-2xl shadow-black/50">
              <p className="px-3 pb-2 pt-1.5 text-sm">
                <span className="block font-medium">{name}</span>
                <span className="block truncate text-muted">{email}</span>
                <span className="mt-1 block truncate text-xs text-faint">{ROLE_LABEL[access.role]} · {access.orgName}</span>
              </p>
              {showTeam && <Link href="/team" onClick={() => setMenu(false)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-muted hover:bg-card hover:text-fg"><IconShield size={18} /> Team & permissions</Link>}
              {showAi && <Link href="/settings/ai" onClick={() => setMenu(false)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-muted hover:bg-card hover:text-fg"><IconSparkle size={18} /> AI {access.can('manage_ai') ? 'keys & usage' : 'usage'}</Link>}
              <form action="/auth/signout" method="post">
                <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-muted hover:bg-card hover:text-fg"><IconLogout size={18} /> Sign out</button>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
