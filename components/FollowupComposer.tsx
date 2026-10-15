'use client';
import { useEffect, useMemo, useState } from 'react';
import { IconSparkle, IconSend, IconAlert, IconCheck, IconMail, IconChat } from '@/components/Icons';
import { renderEmail } from '@/lib/emailTemplate';
import { SendAsSelect, defaultSender, type Meta } from '@/components/assist/ui';

export type Channel = 'sms' | 'email' | 'facebook' | 'instagram';
export interface ChannelState { available: boolean; reason?: string; closesAt?: string }
export interface Draft { short: string; email_subject: string; email_body: string; error?: string }

const LABEL: Record<Channel, string> = { sms: 'SMS', email: 'Email', facebook: 'Facebook', instagram: 'Instagram' };
const ORDER: Channel[] = ['sms', 'email', 'facebook', 'instagram'];
const LEAD_CHANNEL: Record<string, Channel> = { SMS: 'sms', Email: 'email', Facebook: 'facebook', Instagram: 'instagram' };

const field = 'w-full rounded-2xl border border-line bg-card px-4 text-[15px] text-fg placeholder:text-faint outline-none transition focus:border-cyan focus:ring-3 focus:ring-cyan/20';

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export default function FollowupComposer({
  subaccountId, contactId, contactName, senderName: myName, userEmail = '', states, draft: initialDraft, lastLeadChannel, onSent
}: {
  subaccountId: string; contactId: string; contactName: string; senderName: string; userEmail?: string;
  states: Record<Channel, ChannelState>; draft: Draft | null; lastLeadChannel?: string; onSent: () => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(initialDraft);
  const firstOpen = useMemo(() => {
    const pref = lastLeadChannel && LEAD_CHANNEL[lastLeadChannel];
    if (pref && states[pref]?.available) return pref;
    return ORDER.find((c) => states[c]?.available) || 'sms';
  }, [states, lastLeadChannel]);
  const [channel, setChannel] = useState<Channel>(firstOpen);
  const [short, setShort] = useState(initialDraft?.short || '');
  const [subject, setSubject] = useState(initialDraft?.email_subject || '');
  const [body, setBody] = useState(initialDraft?.email_body || '');
  const [regen, setRegen] = useState(false);
  const [sending, setSending] = useState(false);
  const [warning, setWarning] = useState('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState(false);
  const [branding, setBranding] = useState<unknown>(null);
  const [users, setUsers] = useState<Meta['users']>([]);
  const [fromId, setFromId] = useState('');
  const fromName = users.find((u) => u.id === fromId)?.name || '';
  const senderName = fromName || myName;

  // Team members for "Send as"
  useEffect(() => {
    fetch('/api/ghl/meta?subaccount=' + subaccountId).then((r) => r.json()).then((d) => {
      const list: Meta['users'] = Array.isArray(d.users) ? d.users : [];
      setUsers(list); setFromId(defaultSender(list, '', userEmail));
    }).catch(() => {});
  }, [subaccountId, userEmail]);

  // Branding for the email preview (loaded once per sub-account)
  useEffect(() => {
    if (channel !== 'email' || branding) return;
    fetch('/api/subaccounts/' + subaccountId + '/branding').then((r) => r.json()).then((d) => setBranding(d.branding || {})).catch(() => setBranding({}));
  }, [channel, branding, subaccountId]);

  const isEmail = channel === 'email';
  const edited = isEmail ? subject !== (draft?.email_subject || '') || body !== (draft?.email_body || '') : short !== (draft?.short || '');
  const text = isEmail ? body : short;
  const segments = Math.max(1, Math.ceil(short.length / 160));
  const state = states[channel];

  async function regenerate() {
    setRegen(true); setResult(null);
    try {
      const r = await fetch('/api/leads/followup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subaccountId, contactId }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not write a follow-up');
      setDraft(d); setShort(d.short); setSubject(d.email_subject); setBody(d.email_body);
    } catch (e) { setResult({ ok: false, text: (e as Error).message }); }
    finally { setRegen(false); }
  }

  async function send(confirm = false) {
    setSending(true); setResult(null); setWarning('');
    try {
      const r = await fetch('/api/leads/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subaccountId, contactId, channel, subject: isEmail ? subject : undefined, body: text, fromUserId: fromId, fromName, aiSuggested: !!draft && !draft.error, edited, confirm })
      });
      const d = await r.json();
      if (r.status === 409 && d.warning) { setWarning(d.warning); return; }
      if (!r.ok) throw new Error(d.error || 'Could not send');
      setResult({ ok: true, text: `${LABEL[channel]} sent to ${contactName}${fromName ? ' as ' + fromName : ''}.` });
      onSent();
    } catch (e) { setResult({ ok: false, text: (e as Error).message }); }
    finally { setSending(false); }
  }

  const previewHtml = useMemo(
    () => (isEmail && preview ? renderEmail({ companyName: '', ...(branding as object || {}) }, { subject, body, senderName, firstName: contactName.split(/\s+/)[0] }) : ''),
    [isEmail, preview, branding, subject, body, senderName, contactName]
  );

  return (
    <div className="rounded-[24px] border border-line bg-panel p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-lg font-semibold"><IconSparkle size={18} className="text-cyan" /> Suggested follow-up</h3>
        <button onClick={regenerate} disabled={regen} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-card px-3.5 text-sm text-muted hover:bg-card-2 hover:text-fg disabled:opacity-60">
          <IconSparkle size={15} /> {regen ? 'Writing…' : draft ? 'Rewrite' : 'Write with AI'}
        </button>
      </div>

      {/* Channel picker: unavailable channels are greyed out with the reason */}
      <div role="radiogroup" aria-label="Send via" className="flex flex-wrap gap-2">
        {ORDER.map((c) => {
          const s = states[c];
          const active = c === channel;
          return (
            <button key={c} role="radio" aria-checked={active} disabled={!s?.available} title={s?.available ? '' : s?.reason}
              onClick={() => { setChannel(c); setResult(null); setWarning(''); }}
              className={`inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition ${
                !s?.available ? 'cursor-not-allowed bg-card/50 text-faint line-through decoration-faint/60'
                  : active ? 'bg-cyan text-cyan-ink' : 'bg-card text-fg hover:bg-card-2'}`}>
              {c === 'email' ? <IconMail size={15} /> : <IconChat size={15} />} {LABEL[c]}
            </button>
          );
        })}
      </div>
      <ul className="mt-2 space-y-0.5 text-xs text-muted">
        {ORDER.filter((c) => !states[c]?.available).map((c) => <li key={c}>{LABEL[c]}: {states[c]?.reason}</li>)}
        {(['facebook', 'instagram'] as Channel[]).filter((c) => states[c]?.available && states[c]?.closesAt).map((c) => (
          <li key={c} className="text-cyan">{LABEL[c]} window open until {timeOf(states[c].closesAt!)}</li>
        ))}
      </ul>

      {draft?.error && <p className="mt-3 rounded-2xl bg-bad/10 px-4 py-3 text-sm text-bad">AI suggestion failed: {draft.error}. You can still write the message yourself.</p>}

      <div className="mt-4 space-y-3">
        {users.length > 0 && <SendAsSelect users={users} value={fromId} onChange={setFromId} />}
        {isEmail && (
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" aria-label="Email subject" className={field + ' h-12'} />
        )}
        <textarea value={isEmail ? body : short} onChange={(e) => (isEmail ? setBody(e.target.value) : setShort(e.target.value))}
          rows={isEmail ? 9 : 4} aria-label="Message" placeholder={draft ? '' : 'Write your follow-up…'}
          className={field + ' resize-y py-3 leading-relaxed'} />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>
            {draft && !draft.error ? (edited ? 'Edited · ' : 'AI suggestion · ') : ''}
            {isEmail ? 'Your signature and branding are added automatically.' : `${short.length} characters${channel === 'sms' ? ` · ${segments} SMS segment${segments > 1 ? 's' : ''}` : ''}`}
          </span>
          {isEmail && <button onClick={() => setPreview((p) => !p)} className="text-cyan hover:underline">{preview ? 'Hide preview' : 'Preview email'}</button>}
        </div>
        {previewHtml && (
          <iframe title="Email preview" srcDoc={previewHtml} sandbox="" className="h-[480px] w-full rounded-2xl border border-line bg-white" />
        )}
      </div>

      {warning && (
        <div role="alertdialog" aria-label="Recent message warning" className="mt-4 rounded-2xl border border-[#f5b041]/40 bg-[#f5b041]/10 p-4">
          <p className="flex gap-2 text-sm text-[#f8c471]"><IconAlert size={18} className="shrink-0" /> {warning}</p>
          <div className="mt-3 flex gap-2">
            <button onClick={() => send(true)} disabled={sending} className="h-10 rounded-full bg-[#f5b041] px-5 text-sm font-semibold text-[#2b1d05] disabled:opacity-60">Send anyway</button>
            <button onClick={() => setWarning('')} className="h-10 rounded-full bg-card px-5 text-sm hover:bg-card-2">Cancel</button>
          </div>
        </div>
      )}

      {result && (
        <p className={`mt-4 flex items-center gap-2 rounded-2xl px-4 py-3 text-sm ${result.ok ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad'}`}>
          {result.ok ? <IconCheck size={18} /> : <IconAlert size={18} />} {result.text}
        </p>
      )}

      {!warning && (
        <button onClick={() => send(false)} disabled={sending || !state?.available || !text.trim() || (isEmail && !subject.trim())}
          className="mt-4 inline-flex h-12 items-center gap-2 rounded-full bg-cyan px-6 font-semibold text-cyan-ink transition hover:bg-[#7ddcf7] disabled:cursor-not-allowed disabled:opacity-50">
          <IconSend size={18} /> {sending ? 'Sending…' : `Send ${LABEL[channel]}`}
        </button>
      )}
    </div>
  );
}
