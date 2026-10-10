'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconBell, IconX, IconBuilding } from '@/components/Icons';
import { supabaseBrowser } from '@/lib/supabase/client';
import { relative } from '@/components/ActivityItem';

interface Note { id: number; created_at: string; subaccount_id: string; subaccount_name: string; contact_id: string; contact_name: string; channel: string; preview: string }
type PushState = 'loading' | 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on' | 'no-key';

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

function keyBytes(base64: string) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';

export default function NotificationCenter() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Note[]>([]);
  const [readAt, setReadAt] = useState('');
  const [unread, setUnread] = useState(0);
  const [toast, setToast] = useState<Note | null>(null);
  const [push, setPush] = useState<PushState>('loading');
  const [pushBusy, setPushBusy] = useState(false);
  const [settings, setSettings] = useState(false);
  const [subs, setSubs] = useState<{ id: string; name: string }[] | null>(null);
  const [muted, setMuted] = useState<string[]>([]);
  const newest = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/notifications', { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      const list: Note[] = d.items || [];
      // In-app toast for messages that arrived since the last check (not on first load)
      if (newest.current !== null && list[0] && list[0].id > newest.current && document.visibilityState === 'visible') {
        setToast(list[0]);
        setTimeout(() => setToast((t) => (t && t.id === list[0].id ? null : t)), 7000);
      }
      newest.current = list[0]?.id ?? 0;
      setItems(list); setReadAt(d.readAt); setUnread(d.unread); setMuted(d.muted || []);
    } catch { /* offline: try again next tick */ }
  }, []);

  // Instant refresh via Supabase Realtime (the server broadcasts a ping on each new message),
  // plus a slow poll, refresh on focus, and refresh when the service worker receives a push
  useEffect(() => {
    load();
    const supabase = supabaseBrowser();
    const channel = supabase.channel('nova-notifications').on('broadcast', { event: 'new' }, () => load()).subscribe();
    const t = setInterval(load, 60000);
    const onFocus = () => load();
    const onSw = (e: MessageEvent) => { if (e.data?.type === 'nova-notification') load(); };
    window.addEventListener('focus', onFocus);
    navigator.serviceWorker?.addEventListener('message', onSw);
    return () => {
      clearInterval(t); supabase.removeChannel(channel);
      window.removeEventListener('focus', onFocus); navigator.serviceWorker?.removeEventListener('message', onSw);
    };
  }, [load]);

  // Register the service worker and work out the push state
  useEffect(() => {
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
        const standalone = window.matchMedia('(display-mode: standalone)').matches;
        setPush(ios && !standalone ? 'needs-install' : 'unsupported');
        return;
      }
      if (!VAPID) { setPush('no-key'); return; }
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        const sub = await reg.pushManager.getSubscription();
        setPush(Notification.permission === 'denied' ? 'denied' : sub ? 'on' : 'off');
      } catch { setPush('unsupported'); }
    })();
  }, []);

  async function enablePush() {
    setPushBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setPush(perm === 'denied' ? 'denied' : 'off'); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ||
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID) }));
      const r = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) });
      setPush(r.ok ? 'on' : 'off');
    } catch { setPush('off'); }
    finally { setPushBusy(false); }
  }

  async function disablePush() {
    setPushBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push/subscribe', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setPush('off');
    } finally { setPushBusy(false); }
  }

  async function togglePanel() {
    const next = !open;
    setOpen(next);
    if (next && unread) {
      setUnread(0);
      const r = await fetch('/api/notifications', { method: 'POST' }).catch(() => null);
      const d = r && r.ok ? await r.json() : null;
      if (d?.readAt) setTimeout(() => setReadAt(d.readAt), 4000); // keep the "new" dots visible for a moment
    }
  }

  async function openSettings() {
    setSettings((v) => !v);
    if (!subs) {
      const r = await fetch('/api/subaccounts').catch(() => null);
      const d = r && r.ok ? await r.json() : { items: [] };
      setSubs((d.items || []).map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })));
    }
  }

  async function toggleSub(id: string, enabled: boolean) {
    setMuted((m) => (enabled ? m.filter((x) => x !== id) : [...m, id]));
    const r = await fetch('/api/notifications/prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subaccountId: id, enabled }) }).catch(() => null);
    if (r && r.ok) { const d = await r.json(); setMuted(d.muted); load(); }
  }

  function go(n: Note) {
    setOpen(false); setToast(null);
    router.push(`/leads?sa=${n.subaccount_id}&contact=${encodeURIComponent(n.contact_id)}`);
  }

  const pushBox: Record<PushState, React.ReactNode> = {
    loading: null,
    on: <div className="flex items-center justify-between gap-3"><span>Push notifications are <b className="text-cyan">on</b> for this device.</span><button disabled={pushBusy} onClick={disablePush} className="shrink-0 text-muted underline hover:text-fg">Turn off</button></div>,
    off: <div className="flex items-center justify-between gap-3"><span>Get a push notification when a contact messages.</span><button disabled={pushBusy} onClick={enablePush} className="h-9 shrink-0 rounded-full bg-cyan px-4 font-semibold text-cyan-ink disabled:opacity-60">Turn on</button></div>,
    denied: <span>Notifications are blocked for this site. Allow them in your browser&apos;s site settings, then reload.</span>,
    unsupported: <span>This browser doesn&apos;t support push notifications. New messages still show here.</span>,
    'needs-install': <span>On iPhone/iPad: tap <b>Share</b> › <b>Add to Home Screen</b>, open Nova from there, then turn on notifications here.</span>,
    'no-key': <span>Push isn&apos;t configured yet (NEXT_PUBLIC_VAPID_PUBLIC_KEY). New messages still show here.</span>
  };

  return (
    <>
      <button onClick={togglePanel} aria-label={`Notifications${unread ? `, ${unread} new` : ''}`}
        className="relative flex size-11 items-center justify-center rounded-full bg-card text-muted transition hover:bg-card-2 hover:text-fg">
        <IconBell size={20} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-cyan px-1 text-[11px] font-bold text-cyan-ink">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* In-app toast */}
      {toast && !open && (
        <button onClick={() => go(toast)}
          className="activity-in fixed right-4 top-20 z-50 flex w-[min(92vw,360px)] gap-3 rounded-2xl border border-line bg-panel p-4 text-left shadow-2xl shadow-black/50">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-cyan/15 text-sm font-semibold text-cyan">{initials(toast.contact_name)}</span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{toast.contact_name} <span className="font-normal text-muted">· {toast.channel}</span></span>
            <span className="mt-0.5 line-clamp-2 block text-sm text-muted">{toast.preview}</span>
          </span>
        </button>
      )}

      {open && <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setOpen(false)} />}
      <aside aria-label="Notifications" aria-hidden={!open}
        className={`fixed inset-y-0 right-0 z-50 flex w-[min(100vw,400px)] flex-col border-l border-line bg-panel shadow-2xl transition-transform duration-200 ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold">{settings ? 'Alert settings' : 'Notifications'}</h2>
          <div className="flex items-center gap-1">
            <button onClick={openSettings} aria-pressed={settings} className={`h-9 rounded-full px-3 text-sm ${settings ? 'bg-cyan/15 text-cyan' : 'text-muted hover:bg-card hover:text-fg'}`}>
              {settings ? 'Done' : 'Settings'}
            </button>
            <button onClick={() => setOpen(false)} aria-label="Close" className="flex size-9 items-center justify-center rounded-full hover:bg-card"><IconX size={18} /></button>
          </div>
        </div>
        {settings && (
          <div className="flex-1 overflow-y-auto p-5">
            <p className="mb-3 text-sm text-muted">Choose which sub-accounts you get alerts for. This applies to the bell and to push notifications on all your devices.</p>
            <ul className="space-y-2">
              {subs === null && <li className="h-14 animate-pulse rounded-2xl bg-card" />}
              {subs?.map((x) => {
                const on = !muted.includes(x.id);
                return (
                  <li key={x.id}>
                    <button onClick={() => toggleSub(x.id, !on)} role="switch" aria-checked={on}
                      className="flex w-full items-center gap-3 rounded-2xl bg-card p-3.5 text-left hover:bg-card-2">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-cyan/12 text-cyan"><IconBuilding size={17} /></span>
                      <span className="min-w-0 flex-1 truncate text-[15px]">{x.name}</span>
                      <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? 'bg-cyan' : 'bg-card-2'}`}>
                        <span className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
                      </span>
                    </button>
                  </li>
                );
              })}
              {subs && !subs.length && <li className="text-sm text-muted">No sub-accounts yet.</li>}
            </ul>
          </div>
        )}
        {!settings && pushBox[push] && <div className="border-b border-line bg-card/50 px-5 py-3 text-sm text-muted">{pushBox[push]}</div>}
        <ul className={`flex-1 overflow-y-auto p-3 ${settings ? 'hidden' : ''}`}>
          {items.map((n) => (
            <li key={n.id}>
              <button onClick={() => go(n)} className="flex w-full gap-3 rounded-2xl p-3 text-left hover:bg-card">
                <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-card-2 text-sm font-semibold text-cyan">
                  {initials(n.contact_name)}
                  {n.created_at > readAt && <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-panel bg-cyan" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[15px] font-medium">{n.contact_name}</span>
                    <span className="shrink-0 text-xs text-muted">{relative(n.created_at)}</span>
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-sm text-muted">{n.preview}</span>
                  <span className="mt-1 block text-xs text-faint">{n.channel} · {n.subaccount_name}</span>
                </span>
              </button>
            </li>
          ))}
          {!items.length && (
            <li className="p-6 text-center text-sm text-muted">
              No messages yet. When a contact replies in GHL, it shows up here. Set up the webhook on the Sub-accounts page.
            </li>
          )}
        </ul>
      </aside>
    </>
  );
}
