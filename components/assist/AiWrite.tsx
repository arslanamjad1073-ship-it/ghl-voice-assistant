'use client';
import { useState } from 'react';
import { input, postJson } from '@/components/assist/ui';
import { IconSparkle } from '@/components/Icons';

// "Ask AI to write…" box; the result is put into the form fields for the user to edit
export default function AiWrite({ subaccountId, kind, contactId, onResult }: {
  subaccountId: string; kind: 'email' | 'sms' | 'note'; contactId?: string; onResult: (r: { subject: string; body: string }) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function go(e?: React.FormEvent) {
    e?.preventDefault();
    if (!text.trim()) return;
    setBusy(true); setErr('');
    const { ok, data } = await postJson<{ subject: string; body: string }>('/api/assist/write', { subaccountId, kind, instruction: text, contactId });
    setBusy(false);
    if (!ok) return setErr(data.error || 'AI could not write it');
    onResult(data);
  }
  return (
    <div className="rounded-2xl border border-dashed border-cyan/30 bg-cyan/5 p-3">
      <div className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
          placeholder={kind === 'note' ? 'Ask AI: summarize the call, they want a quote…' : 'Ask AI to write it: thank them for the call and offer Tuesday…'}
          className={input + ' h-10 bg-panel'} aria-label="Ask AI to write" />
        <button type="button" onClick={() => go()} disabled={busy || !text.trim()}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-cyan/15 px-4 text-sm font-semibold text-cyan hover:bg-cyan/25 disabled:opacity-50">
          <IconSparkle size={15} /> {busy ? 'Writing…' : 'Write'}
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-bad">{err}</p>}
    </div>
  );
}
