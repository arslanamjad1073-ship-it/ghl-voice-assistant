'use client';
import { useEffect, useState } from 'react';
import { input, ACTION, type Contact } from '@/components/assist/ui';
import { IconSearch, IconPlus, IconX } from '@/components/Icons';

const isEmail = (q: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(q.trim());
const isPhone = (q: string) => q.replace(/\D/g, '').length >= 7 && /^[+()\d\s.-]+$/.test(q.trim());

// Pick a contact: search by name, email or phone; create one if an email/phone isn't found
export default function ContactPicker({ subaccountId, value, onChange, initialQuery = '', candidates = [], need }: {
  subaccountId: string; value: Contact | null; onChange: (c: Contact | null) => void;
  initialQuery?: string; candidates?: Contact[]; need?: 'email' | 'phone';
}) {
  const [q, setQ] = useState(value ? '' : initialQuery);
  const [list, setList] = useState<Contact[]>(candidates);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (value || !q.trim()) return;
    const t = setTimeout(async () => {
      setLoading(true); setErr('');
      try {
        const r = await fetch('/api/leads/contacts?' + new URLSearchParams({ subaccount: subaccountId, q: q.trim() }));
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setList(d.items || []);
      } catch (e) { setErr((e as Error).message || 'Search failed'); }
      finally { setLoading(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [q, value, subaccountId]);

  async function create() {
    setCreating(true); setErr('');
    const { ok, data } = await ACTION(subaccountId, 'create_contact', undefined, { email: isEmail(q) ? q.trim() : '', phone: isPhone(q) ? q.trim() : '', name: newName });
    setCreating(false);
    if (!ok) return setErr(data.error || 'Could not create the contact');
    onChange((data as unknown as { contact: Contact }).contact);
  }

  if (value) {
    const missing = need && !value[need];
    return (
      <div>
        <div className="flex items-center gap-3 rounded-xl border border-line bg-card px-3.5 py-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-cyan/15 text-xs font-semibold text-cyan">
            {value.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14.5px] font-medium">{value.name}</span>
            <span className="block truncate text-xs text-muted">{[value.email, value.phone].filter(Boolean).join(' · ') || 'No email or phone'}</span>
          </span>
          <button type="button" onClick={() => { onChange(null); setQ(''); }} aria-label="Change contact" className="flex size-8 items-center justify-center rounded-full text-muted hover:bg-card-2 hover:text-fg"><IconX size={16} /></button>
        </div>
        {missing && <p className="mt-1.5 text-xs text-bad">This contact has no {need === 'email' ? 'email address' : 'phone number'}.</p>}
      </div>
    );
  }

  const canCreate = (isEmail(q) || isPhone(q)) && !loading && !list.some((c) => c.email.toLowerCase() === q.trim().toLowerCase());
  return (
    <div>
      <div className="relative">
        <IconSearch size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or phone" className={input + ' pl-10'} aria-label="Contact" />
      </div>
      {(list.length > 0 || loading || canCreate || err) && (
        <ul className="mt-2 max-h-60 space-y-1 overflow-y-auto rounded-xl border border-line bg-card p-1.5">
          {loading && <li className="px-3 py-2 text-sm text-muted">Searching…</li>}
          {!loading && list.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => onChange(c)} className="w-full rounded-lg px-3 py-2 text-left hover:bg-card-2">
                <span className="block text-sm font-medium">{c.name}</span>
                <span className="block text-xs text-muted">{[c.email, c.phone].filter(Boolean).join(' · ')}</span>
              </button>
            </li>
          ))}
          {canCreate && (
            <li className="space-y-2 border-t border-line p-2">
              <p className="text-xs text-muted">No contact with {q.trim()} yet.</p>
              <div className="flex gap-2">
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name (optional)" className={input + ' h-9'} />
                <button type="button" onClick={create} disabled={creating} className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full bg-cyan px-3.5 text-sm font-semibold text-cyan-ink disabled:opacity-60">
                  <IconPlus size={15} /> {creating ? 'Creating…' : 'Create contact'}
                </button>
              </div>
            </li>
          )}
          {err && <li className="px-3 py-2 text-sm text-bad">{err}</li>}
        </ul>
      )}
    </div>
  );
}
