'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccess } from '@/components/AccessProvider';
import { Field, input, primaryBtn, ghostBtn } from '@/components/assist/ui';
import { PERMISSIONS, PERMISSION_INFO, DEFAULT_PERMISSIONS, ROLE_LABEL, type Permission, type Role } from '@/lib/permissions';
import { IconPlus, IconEdit, IconTrash, IconCheck, IconCopy, IconShield, IconMail, IconX } from '@/components/Icons';

interface Member {
  id: string; user_id: string; email: string; name: string; role: Role; permissions: Permission[] | null;
  all_subaccounts: boolean; status: 'active' | 'disabled'; subaccount_ids: string[]; created_at: string;
}
interface Invite {
  id: string; email: string; name: string | null; role: 'admin' | 'user'; permissions: Permission[]; all_subaccounts: boolean;
  subaccount_ids: string[]; token: string; invited_by_name: string; expires_at: string; expired: boolean;
}
interface Team {
  org: { id: string; name: string };
  me: { userId: string; role: Role; permissions: Permission[]; allSubaccounts: boolean; canRename: boolean };
  members: Member[]; invites: Invite[]; subaccounts: { id: string; name: string }[]; canInviteAdmins: boolean;
}
interface FormState { email: string; name: string; role: 'admin' | 'user'; permissions: Permission[]; allSubaccounts: boolean; subaccountIds: string[] }

const initials = (s: string) => s.split(/[\s@.]+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const ROLE_STYLE: Record<Role, string> = { owner: 'bg-cyan/15 text-cyan', admin: 'bg-[#a78bfa]/15 text-[#c4b5fd]', user: 'bg-card-2 text-muted' };

function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-40 ${on ? 'bg-cyan' : 'bg-card-2'}`}>
      <span className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

export default function TeamPage() {
  const access = useAccess();
  const router = useRouter();
  const [team, setTeam] = useState<Team | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState<FormState | null>(null);
  const [editing, setEditing] = useState<Member | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [sentLink, setSentLink] = useState<{ link: string; email: string; emailSent: boolean; note: string } | null>(null);
  const [copied, setCopied] = useState('');
  const [orgName, setOrgName] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch('/api/team', { cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setError(d.error || 'Could not load the team'); return; }
    setTeam(d); setError('');
  }, []);
  useEffect(() => { load(); }, [load]);

  const me = team?.me;
  const isOwner = me?.role === 'owner';
  const mayGive = (p: Permission) => isOwner || !!me?.permissions.includes(p);
  const mayManage = (m: Member) => !!me && m.role !== 'owner' && m.user_id !== me.userId && (isOwner || m.role === 'user');
  const subName = (id: string) => team?.subaccounts.find((s) => s.id === id)?.name || 'Sub-account';

  function openInvite() {
    const role = 'user';
    setForm({ email: '', name: '', role, permissions: DEFAULT_PERMISSIONS[role].filter(mayGive), allSubaccounts: false, subaccountIds: [] });
    setEditing('new'); setFormError(''); setSentLink(null); setNotice('');
  }
  function openEdit(m: Member) {
    setForm({ email: m.email, name: m.name, role: m.role === 'admin' ? 'admin' : 'user', permissions: m.permissions || [], allSubaccounts: m.all_subaccounts, subaccountIds: m.subaccount_ids });
    setEditing(m); setFormError(''); setSentLink(null); setNotice('');
  }
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  function setRole(role: 'admin' | 'user') {
    if (!form) return;
    if (editing === 'new') setForm({ ...form, role, permissions: DEFAULT_PERMISSIONS[role].filter(mayGive), allSubaccounts: role === 'admin' && !!me?.allSubaccounts });
    else set('role', role);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true); setFormError('');
    const isNew = editing === 'new';
    // Permissions the editor cannot give stay as they are on the server
    const body = { ...form, permissions: form.permissions.filter(mayGive), subaccountIds: form.allSubaccounts ? [] : form.subaccountIds };
    const r = await fetch(isNew ? '/api/team/invites' : '/api/team/members/' + (editing as Member).id, {
      method: isNew ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setFormError(d.error || 'Could not save'); return; }
    if (isNew) setSentLink({ link: d.link, email: form.email, emailSent: !!d.emailSent, note: d.emailNote || '' });
    else setNotice(`Access for ${form.name || form.email} updated.`);
    setEditing(null); setForm(null);
    load();
  }

  async function act(url: string, method: string, body: object | undefined, done: string, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setError(''); setNotice('');
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setError(d.error || 'Something went wrong'); return false; }
    setNotice(done); load(); return true;
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(text); setTimeout(() => setCopied(''), 2000); } catch { /* clipboard blocked */ }
  }

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    if (orgName === null) return;
    if (await act('/api/team', 'PATCH', { name: orgName }, 'Organization renamed.')) { setOrgName(null); router.refresh(); }
  }

  async function transfer(m: Member) {
    const ok = await act('/api/team/transfer', 'POST', { membershipId: m.id }, `${m.name || m.email} is now the owner.`,
      `Make ${m.name || m.email} the owner? You will become an admin with full access, and only they can make you owner again.`);
    if (ok) router.refresh();
  }

  if (!access.can('manage_team')) {
    return <p className="rounded-2xl bg-card px-4 py-3 text-sm text-muted">You do not have permission to manage the team. Ask the owner.</p>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[30px] font-semibold tracking-tight">Team</h1>
          {orgName === null ? (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-[15px] text-muted">
              {team?.org.name || access.orgName}
              {me?.canRename && <button onClick={() => setOrgName(team?.org.name || '')} className="text-sm text-cyan hover:underline">Rename</button>}
            </p>
          ) : (
            <form onSubmit={rename} className="mt-2 flex gap-2">
              <input value={orgName} onChange={(e) => setOrgName(e.target.value)} className={input + ' max-w-xs'} aria-label="Organization name" autoFocus />
              <button className={primaryBtn + ' h-11 px-4'}>Save</button>
              <button type="button" onClick={() => setOrgName(null)} className="h-11 rounded-full bg-card px-4 text-sm">Cancel</button>
            </form>
          )}
        </div>
        {!editing && (
          <button onClick={openInvite} className="inline-flex h-12 items-center gap-2 rounded-full bg-cyan px-5 font-semibold text-cyan-ink hover:bg-[#7ddcf7]">
            <IconPlus size={18} /> Invite someone
          </button>
        )}
      </div>

      {notice && <p className="mt-5 flex items-center gap-2 rounded-2xl bg-cyan/10 px-4 py-3 text-sm text-cyan"><IconCheck size={18} />{notice}</p>}
      {error && <p className="mt-5 rounded-2xl bg-bad/10 px-4 py-3 text-sm text-bad">{error}</p>}

      {sentLink && (
        <div className="mt-5 rounded-2xl border border-cyan/30 bg-cyan/5 p-4 text-sm">
          <p className="flex items-center gap-2 font-medium"><IconMail size={17} className="text-cyan" />
            {sentLink.emailSent ? `Invite emailed to ${sentLink.email}.` : `Invite created for ${sentLink.email}.`}
          </p>
          <p className="mt-1 text-muted">
            {sentLink.emailSent ? 'You can also send them this link yourself (valid 7 days):' : `The email could not be sent${sentLink.note ? ` (${sentLink.note})` : ''}. Send them this link (valid 7 days):`}
          </p>
          <div className="mt-2 flex gap-2">
            <code className="min-w-0 flex-1 truncate rounded-xl bg-card px-3 py-2.5 font-mono text-xs">{sentLink.link}</code>
            <button onClick={() => copy(sentLink.link)} className="shrink-0 rounded-xl bg-cyan px-3.5 text-xs font-semibold text-cyan-ink">{copied === sentLink.link ? 'Copied' : 'Copy'}</button>
          </div>
        </div>
      )}

      {editing && form && team && (
        <form onSubmit={save} className="mt-6 space-y-5 rounded-[28px] border border-line bg-panel p-5 sm:p-7">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-xl font-semibold">{editing === 'new' ? 'Invite someone' : `Access for ${editing.name || editing.email}`}</h2>
            <button type="button" onClick={() => { setEditing(null); setForm(null); }} aria-label="Close" className="flex size-9 items-center justify-center rounded-full text-muted hover:bg-card hover:text-fg"><IconX size={18} /></button>
          </div>

          {editing === 'new' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email *"><input type="email" required value={form.email} onChange={(e) => set('email', e.target.value)} className={input} placeholder="sara@company.com" autoComplete="off" /></Field>
              <Field label="Name"><input value={form.name} onChange={(e) => set('name', e.target.value)} className={input} placeholder="Sara Khan" /></Field>
            </div>
          )}

          <Field label="Role" hint={form.role === 'admin' ? 'Admins usually help run the team. They only get the permissions switched on below.' : 'Users work in the sub-accounts they are given.'}>
            <div role="radiogroup" aria-label="Role" className="grid h-11 max-w-sm grid-cols-2 gap-1 rounded-xl border border-line bg-card p-1">
              {(['user', 'admin'] as const).map((r) => (
                <button key={r} type="button" role="radio" aria-checked={form.role === r} onClick={() => setRole(r)} disabled={r === 'admin' && !team.canInviteAdmins}
                  title={r === 'admin' && !team.canInviteAdmins ? 'Only the owner can add admins' : ''}
                  className={`rounded-lg text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${form.role === r ? 'bg-cyan text-cyan-ink' : 'text-muted hover:text-fg'}`}>{ROLE_LABEL[r]}</button>
              ))}
            </div>
          </Field>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Permissions</legend>
            <ul className="divide-y divide-line rounded-2xl border border-line bg-card">
              {PERMISSIONS.map((p) => {
                const allowed = mayGive(p);
                return (
                  <li key={p} className="flex items-center justify-between gap-4 px-4 py-3">
                    <span className={allowed ? '' : 'opacity-50'}>
                      <span className="block text-[15px] font-medium">{PERMISSION_INFO[p].label}</span>
                      <span className="block text-xs text-muted">{PERMISSION_INFO[p].hint}{!allowed && ' · you do not have this yourself'}</span>
                    </span>
                    <Toggle label={PERMISSION_INFO[p].label} on={form.permissions.includes(p)} disabled={!allowed}
                      onChange={(v) => set('permissions', v ? [...form.permissions, p] : form.permissions.filter((x) => x !== p))} />
                  </li>
                );
              })}
            </ul>
            <p className="mt-1.5 text-xs text-muted">Everyone can use Nova (prompts, leads, history, voice) in the sub-accounts they can access.</p>
          </fieldset>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Sub-account access</legend>
            <div className="rounded-2xl border border-line bg-card">
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <span className={me?.allSubaccounts ? '' : 'opacity-50'}>
                  <span className="block text-[15px] font-medium">All sub-accounts</span>
                  <span className="block text-xs text-muted">Including ones added later</span>
                </span>
                <Toggle label="All sub-accounts" on={form.allSubaccounts} disabled={!me?.allSubaccounts} onChange={(v) => set('allSubaccounts', v)} />
              </div>
              {!form.allSubaccounts && (
                <ul className="max-h-72 overflow-y-auto border-t border-line p-2">
                  {!team.subaccounts.length && <li className="px-2 py-3 text-sm text-muted">No sub-accounts yet.</li>}
                  {team.subaccounts.map((s) => {
                    const on = form.subaccountIds.includes(s.id);
                    return (
                      <li key={s.id}>
                        <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-card-2">
                          <input type="checkbox" checked={on} className="size-4 accent-[#5ad2f4]"
                            onChange={() => set('subaccountIds', on ? form.subaccountIds.filter((x) => x !== s.id) : [...form.subaccountIds, s.id])} />
                          <span className="text-[15px]">{s.name}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {!form.allSubaccounts && !form.subaccountIds.length && <p className="mt-1.5 text-xs text-[#f8c471]">No sub-accounts selected: they will see nothing until you give access.</p>}
          </fieldset>

          {formError && <p className="rounded-2xl bg-bad/10 px-4 py-3 text-sm text-bad">{formError}</p>}
          <div className="flex gap-3">
            <button disabled={busy} className={primaryBtn + ' h-12'}>{busy ? 'Saving…' : editing === 'new' ? 'Send invite' : 'Save access'}</button>
            <button type="button" onClick={() => { setEditing(null); setForm(null); }} className="h-12 rounded-full bg-card px-6 font-medium hover:bg-card-2">Cancel</button>
          </div>
        </form>
      )}

      <h2 className="mt-8 text-lg font-semibold">Members</h2>
      <ul className="mt-3 grid gap-3 md:grid-cols-2">
        {!team && !error && [0, 1].map((i) => <li key={i} className="h-32 animate-pulse rounded-[24px] bg-card" />)}
        {team?.members.map((m) => (
          <li key={m.id} className={`flex gap-4 rounded-[24px] bg-card p-5 ${m.status === 'disabled' ? 'opacity-60' : ''}`}>
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-cyan/12 text-sm font-semibold text-cyan">{initials(m.name || m.email)}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-[17px] font-semibold">{m.name || m.email}</h3>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_STYLE[m.role]}`}>{ROLE_LABEL[m.role]}</span>
                {m.status === 'disabled' && <span className="rounded-full bg-bad/15 px-2.5 py-0.5 text-xs font-medium text-bad">Disabled</span>}
                {m.user_id === me?.userId && <span className="text-xs text-faint">You</span>}
              </div>
              <p className="truncate text-sm text-muted">{m.email}</p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {m.role === 'owner'
                  ? <span className="inline-flex items-center gap-1 rounded-full bg-ink/60 px-2.5 py-1 text-xs"><IconShield size={13} className="text-cyan" /> Full access</span>
                  : (m.permissions || []).length
                    ? (m.permissions || []).map((p) => <span key={p} className="rounded-full bg-ink/60 px-2.5 py-1 text-xs">{PERMISSION_INFO[p]?.label || p}</span>)
                    : <span className="text-xs text-faint">Uses Nova only</span>}
              </div>
              <p className="mt-2 text-xs text-muted">
                {m.all_subaccounts ? 'All sub-accounts' : m.subaccount_ids.length ? m.subaccount_ids.map(subName).join(', ') : 'No sub-accounts yet'}
              </p>
              {mayManage(m) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => openEdit(m)} className={ghostBtn + ' bg-card-2'}><IconEdit size={15} /> Edit access</button>
                  <button onClick={() => act('/api/team/members/' + m.id, 'PATCH', { status: m.status === 'active' ? 'disabled' : 'active' },
                    m.status === 'active' ? `${m.name || m.email} is disabled and can no longer sign in to Nova.` : `${m.name || m.email} is active again.`)}
                    className={ghostBtn + ' bg-card-2'}>{m.status === 'active' ? 'Disable' : 'Enable'}</button>
                  {isOwner && m.role === 'admin' && m.status === 'active' && (
                    <button onClick={() => transfer(m)} className={ghostBtn + ' bg-card-2'}>Make owner</button>
                  )}
                  <button onClick={() => act('/api/team/members/' + m.id, 'DELETE', undefined, `${m.name || m.email} was removed.`, `Remove ${m.name || m.email} from the team? They lose access right away.`)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm text-bad hover:bg-bad/10"><IconTrash size={15} /> Remove</button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      {!!team?.invites.length && (
        <>
          <h2 className="mt-8 text-lg font-semibold">Pending invites</h2>
          <ul className="mt-3 space-y-2">
            {team.invites.map((i) => {
              const link = (typeof window !== 'undefined' ? window.location.origin : '') + '/invite/' + i.token;
              const canCancel = isOwner || i.role === 'user';
              return (
                <li key={i.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-card px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium">{i.name ? `${i.name} · ` : ''}{i.email}</p>
                    <p className="text-xs text-muted">
                      {ROLE_LABEL[i.role]} · invited by {i.invited_by_name || 'someone'} · {i.expired ? <span className="text-bad">expired</span> : `expires ${new Date(i.expires_at).toLocaleDateString()}`}
                    </p>
                  </div>
                  {!i.expired && i.token && <button onClick={() => copy(link)} className={ghostBtn + ' bg-card-2'}><IconCopy size={15} /> {copied === link ? 'Copied' : 'Copy link'}</button>}
                  {canCancel && <button onClick={() => act('/api/team/invites?id=' + i.id, 'DELETE', undefined, `Invite for ${i.email} cancelled.`)} className="h-9 rounded-full px-3 text-sm text-bad hover:bg-bad/10">Cancel</button>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
