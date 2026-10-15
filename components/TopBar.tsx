'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import NotificationCenter from '@/components/NotificationCenter';
import { IconLogout, IconSparkle } from '@/components/Icons';

export default function TopBar({ name, email }: { name: string; email: string }) {
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  if (path === '/talk') return null; // the call screen has its own header
  return (
    <div className="mb-6 flex items-center justify-between gap-3">
      <Link href="/" className="text-[15px] font-semibold tracking-tight">
        <span className="text-cyan">Flow</span>minds <span className="font-normal text-muted">· Nova</span>
      </Link>
      <div className="relative flex items-center gap-2">
        <Link href="/settings/ai" aria-label="AI keys & usage" title="AI keys & usage"
          className={`inline-flex h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition sm:px-4 ${path.startsWith('/settings/ai') ? 'bg-cyan text-cyan-ink' : 'bg-card text-fg hover:bg-card-2'}`}>
          <IconSparkle size={17} /><span className="hidden sm:inline">AI keys</span>
        </Link>
        <NotificationCenter />
        <button onClick={() => setMenu((m) => !m)} aria-label="Account" aria-expanded={menu}
          className="flex size-11 items-center justify-center rounded-full bg-card text-sm font-semibold text-cyan hover:bg-card-2">
          {name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
        </button>
        {menu && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
            <div className="absolute right-0 top-13 z-40 w-64 rounded-2xl border border-line bg-panel p-2 shadow-2xl shadow-black/50">
              <p className="px-3 pb-2 pt-1.5 text-sm"><span className="block font-medium">{name}</span><span className="block truncate text-muted">{email}</span></p>
              <Link href="/settings/ai" onClick={() => setMenu(false)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-muted hover:bg-card hover:text-fg"><IconSparkle size={18} /> AI settings & usage</Link>
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
