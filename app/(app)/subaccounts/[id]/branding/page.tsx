'use client';
import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { IconBack, IconCheck } from '@/components/Icons';
import { FONTS, defaultBranding, renderEmail, type EmailBranding } from '@/lib/emailTemplate';

const input = 'h-11 w-full rounded-xl border border-line bg-card px-3.5 text-[14.5px] text-fg placeholder:text-faint outline-none transition focus:border-cyan focus:ring-3 focus:ring-cyan/20';

const SAMPLE = {
  subject: 'Your consultation next month',
  body: 'Hi Peter,\n\nThanks for your time on the call today. As promised, here is a quick recap of what we discussed and the next steps.\n\nYou can book a time that suits you here: https://example.com/book\n\nLet me know if you have any questions.',
  senderName: 'Ali Behraz',
  firstName: 'Peter'
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)}
          className="h-11 w-12 shrink-0 cursor-pointer rounded-xl border border-line bg-card p-1" aria-label={label + ' picker'} />
        <input value={value} onChange={(e) => onChange(e.target.value)} className={input + ' font-mono'} maxLength={7} aria-label={label} />
      </div>
    </Field>
  );
}

export default function BrandingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [name, setName] = useState('');
  const [b, setB] = useState<EmailBranding | null>(null);
  const [saved, setSaved] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/subaccounts/' + id + '/branding').then((r) => r.json()).then((d) => {
      if (d.error) { setMsg({ ok: false, text: d.error }); return; }
      setName(d.name); setB(d.branding); setSaved(JSON.stringify(d.branding));
    }).catch(() => setMsg({ ok: false, text: 'Could not load branding' }));
  }, [id]);

  const set = <K extends keyof EmailBranding>(k: K, v: EmailBranding[K]) => { setB((x) => (x ? { ...x, [k]: v } : x)); setMsg(null); };
  const html = useMemo(() => (b ? renderEmail(b, SAMPLE) : ''), [b]);
  const dirty = b && JSON.stringify(b) !== saved;

  async function save() {
    if (!b) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/subaccounts/' + id + '/branding', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ branding: b }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not save');
      setB(d.branding); setSaved(JSON.stringify(d.branding));
      setMsg({ ok: true, text: 'Saved. Follow-up emails for ' + name + ' now use this branding.' });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/subaccounts" aria-label="Back to sub-accounts" className="flex size-11 items-center justify-center rounded-full bg-card hover:bg-card-2"><IconBack size={20} /></Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight">Email branding</h1>
          <p className="text-sm text-muted">{name || '…'} · used for follow-up emails sent from Nova</p>
        </div>
        <button onClick={save} disabled={!b || busy || !dirty}
          className="h-11 rounded-full bg-cyan px-6 font-semibold text-cyan-ink hover:bg-[#7ddcf7] disabled:opacity-50">
          {busy ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
      </div>

      {msg && <p className={`mt-4 flex items-center gap-2 rounded-2xl px-4 py-3 text-sm ${msg.ok ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad'}`}>{msg.ok && <IconCheck size={18} />}{msg.text}</p>}

      {!b ? (
        <div className="mt-6 h-96 animate-pulse rounded-[24px] bg-card" />
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="space-y-6">
            <section className="space-y-4 rounded-[24px] border border-line bg-panel p-5">
              <h2 className="font-semibold">Logo</h2>
              <Field label="Logo image URL" hint="A public https link to a PNG or JPG, e.g. from GHL Media Storage.">
                <input value={b.logoUrl} onChange={(e) => set('logoUrl', e.target.value)} placeholder="https://…/logo.png" className={input} />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label={`Logo width · ${b.logoWidth}px`}>
                  <input type="range" min={40} max={300} value={b.logoWidth} onChange={(e) => set('logoWidth', Number(e.target.value))} className="w-full accent-[#5ad2f4]" />
                </Field>
                <Field label="Alignment">
                  <div className="flex gap-1 rounded-xl bg-card p-1">
                    {(['left', 'center'] as const).map((a) => (
                      <button key={a} type="button" onClick={() => set('align', a)} aria-pressed={b.align === a}
                        className={`h-9 flex-1 rounded-lg text-sm capitalize ${b.align === a ? 'bg-cyan text-cyan-ink' : 'text-muted hover:text-fg'}`}>{a}</button>
                    ))}
                  </div>
                </Field>
              </div>
            </section>

            <section className="space-y-4 rounded-[24px] border border-line bg-panel p-5">
              <h2 className="font-semibold">Text & colours</h2>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Font">
                  <select value={b.fontFamily} onChange={(e) => set('fontFamily', e.target.value)} className={input}>
                    {Object.keys(FONTS).map((f) => <option key={f} value={f}>{f}{FONTS[f].google ? ' (web font)' : ''}</option>)}
                  </select>
                </Field>
                <Field label={`Text size · ${b.fontSize}px`}>
                  <input type="range" min={12} max={22} value={b.fontSize} onChange={(e) => set('fontSize', Number(e.target.value))} className="mt-3 w-full accent-[#5ad2f4]" />
                </Field>
                <ColorField label="Text colour" value={b.textColor} onChange={(v) => set('textColor', v)} />
                <ColorField label="Accent (top bar, links)" value={b.accentColor} onChange={(v) => set('accentColor', v)} />
                <ColorField label="Page background" value={b.backgroundColor} onChange={(v) => set('backgroundColor', v)} />
                <ColorField label="Email background" value={b.cardColor} onChange={(v) => set('cardColor', v)} />
              </div>
              <p className="text-xs text-muted">Web fonts show in Apple Mail and most phones; Gmail and Outlook fall back to a similar standard font.</p>
            </section>

            <section className="space-y-4 rounded-[24px] border border-line bg-panel p-5">
              <h2 className="font-semibold">Signature</h2>
              <Field label="Sign-off" hint="Placeholders: {{sender_name}} (who sends it), {{first_name}} (the contact), {{company}}.">
                <textarea value={b.signature} onChange={(e) => set('signature', e.target.value)} rows={3} className={input + ' h-auto resize-y py-2.5'} />
              </Field>
            </section>

            <section className="space-y-4 rounded-[24px] border border-line bg-panel p-5">
              <h2 className="font-semibold">Footer</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Company name"><input value={b.companyName} onChange={(e) => set('companyName', e.target.value)} className={input} /></Field>
                <Field label="Phone"><input value={b.phone} onChange={(e) => set('phone', e.target.value)} className={input} placeholder="+1 555 0100" /></Field>
                <Field label="Address"><input value={b.address} onChange={(e) => set('address', e.target.value)} className={input} placeholder="Street, City, Country" /></Field>
                <Field label="Website"><input value={b.website} onChange={(e) => set('website', e.target.value)} className={input} placeholder="https://…" /></Field>
                <Field label="Facebook URL"><input value={b.facebook} onChange={(e) => set('facebook', e.target.value)} className={input} placeholder="https://facebook.com/…" /></Field>
                <Field label="Instagram URL"><input value={b.instagram} onChange={(e) => set('instagram', e.target.value)} className={input} placeholder="https://instagram.com/…" /></Field>
                <Field label="LinkedIn URL"><input value={b.linkedin} onChange={(e) => set('linkedin', e.target.value)} className={input} placeholder="https://linkedin.com/…" /></Field>
              </div>
              <Field label="Footer note" hint="Small print, e.g. why they receive this email or opening hours.">
                <textarea value={b.footerNote} onChange={(e) => set('footerNote', e.target.value)} rows={2} className={input + ' h-auto resize-y py-2.5'} />
              </Field>
              <button type="button" onClick={() => { setB({ ...defaultBranding(name) }); setMsg(null); }} className="text-sm text-muted underline hover:text-fg">Reset to defaults</button>
            </section>
          </div>

          <div className="lg:sticky lg:top-6 lg:self-start">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="font-semibold">Live preview</h2>
              <span className="text-xs text-muted">Sample email</span>
            </div>
            <div className="overflow-hidden rounded-[24px] border border-line bg-white">
              <div className="border-b border-black/10 bg-[#f7f7f8] px-4 py-2.5 text-[13px] text-[#555]">
                <span className="font-semibold text-[#222]">{SAMPLE.subject}</span>
              </div>
              <iframe title="Email preview" srcDoc={html} sandbox="" className="h-[640px] w-full bg-white" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
