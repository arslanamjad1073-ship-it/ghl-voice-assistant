'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import Orb, { type OrbState } from '@/components/Orb';
import ActivityItem from '@/components/ActivityItem';
import { IconBack, IconKeyboard, IconMic, IconMicOff, IconSend, IconX } from '@/components/Icons';
import { NovaCall, guessKind, validateTyped, type AskKind } from '@/lib/voice';
import { useSubaccounts } from '@/lib/useSubaccounts';
import type { Activity } from '@/lib/types';

type Phase = 'idle' | 'connecting' | 'live';

const ASK_LABEL: Record<AskKind, string> = {
  email: 'Type the email address',
  phone: 'Type the phone number',
  text: 'Type it here'
};
const PLACEHOLDER: Record<AskKind, string> = { email: 'name@company.com', phone: '+1 555 0100', text: 'Email, phone or name' };

export default function TalkPage() {
  const router = useRouter();
  const sa = useSubaccounts();
  const [phase, setPhase] = useState<Phase>('idle');
  const [muted, setMuted] = useState(false);
  const [status, setStatus] = useState('Hi, how can I help you?');
  const [items, setItems] = useState<Activity[]>([]);
  const [typeOpen, setTypeOpen] = useState(false);
  const [ask, setAsk] = useState<{ kind: AskKind; label: string } | null>(null);
  const [value, setValue] = useState('');
  const [hint, setHint] = useState<{ text: string; bad?: boolean } | null>(null);
  const [working, setWorking] = useState('');
  const callRef = useRef<NovaCall | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Hang up if the user leaves the page mid-call
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (callRef.current?.active) e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('beforeunload', warn); callRef.current?.hangup(); };
  }, []);

  useEffect(() => { if (ask || typeOpen) inputRef.current?.focus(); }, [ask, typeOpen]);

  function reset() {
    setMuted(false); setTypeOpen(false); setAsk(null); setValue(''); setHint(null); setWorking('');
  }

  async function start() {
    if (!sa.selected) { setStatus('Choose a sub-account first.'); return; }
    setPhase('connecting');
    setItems([]);
    setStatus('Connecting… allow the microphone if your browser asks.');
    const call = new NovaCall({
      onConnected: () => { setPhase('live'); setStatus('Nova is listening. Go ahead.'); },
      onEnded: (reason) => {
        callRef.current = null; setPhase('idle'); reset();
        setStatus(reason === 'ended' ? 'Call ended. Tap the mic to talk again.' : 'Call ' + reason + '. Tap the mic to retry.');
      },
      onActivity: (item) => { setWorking(''); setItems((list) => [item, ...list]); },
      onWorking: (label) => setWorking(label),
      onAsk: (kind, label) => { setAsk({ kind, label: label || ASK_LABEL[kind] }); setHint(null); },
      onReceived: (v) => setHint({ text: 'Nova received: ' + v })
    });
    callRef.current = call;
    try {
      await call.start(sa.selected);
    } catch (err) {
      callRef.current = null; setPhase('idle'); reset();
      const e = err as { name?: string; code?: number; message?: string };
      setStatus(
        e?.name === 'NotAllowedError' ? 'Microphone is blocked. Allow it from the icon in the address bar.'
          : 'Could not connect' + (e?.code ? ' (code ' + e.code + ')' : e?.message ? ': ' + e.message : '') + '. Tap the mic to retry.'
      );
      console.warn('[Nova]', err);
    }
  }

  function onMic() {
    if (phase === 'idle') return void start();
    if (phase !== 'live') return;
    const next = !muted;
    setMuted(next);
    callRef.current?.setMuted(next);
    setStatus(next ? 'Microphone muted.' : 'Nova is listening. Go ahead.');
  }

  function onClose() {
    if (callRef.current) callRef.current.hangup();
    else router.push('/');
  }

  function send(e?: React.FormEvent) {
    e?.preventDefault();
    const v = value.trim();
    if (!v || !callRef.current) return;
    const kind = ask ? ask.kind : guessKind(v);
    const problem = validateTyped(kind, v);
    if (problem) return setHint({ text: problem, bad: true });
    try { callRef.current.sendTyped(kind, v); }
    catch { return setHint({ text: 'Could not send. Try again.', bad: true }); }
    setHint({ text: 'Sent to Nova: ' + v });
    setValue(''); setAsk(null);
  }

  const orbState: OrbState = phase === 'connecting' || working ? 'connecting' : phase === 'live' ? (muted ? 'muted' : 'live') : 'idle';
  const showType = phase === 'live' && (typeOpen || !!ask);
  const kind = ask?.kind || 'text';

  return (
    <div className="flex min-h-[calc(100dvh-3rem)] flex-col">
      <header className="flex items-center gap-4">
        <Link href="/" onClick={(e) => { if (callRef.current) { e.preventDefault(); setStatus('End the call before leaving.'); } }}
          aria-label="Back" className="flex size-12 shrink-0 items-center justify-center rounded-full bg-card text-fg hover:bg-card-2">
          <IconBack size={22} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-semibold leading-tight">Speaking to Nova</h1>
          {sa.items.length > 1 && phase === 'idle' ? (
            <select value={sa.selected} onChange={(e) => sa.setSelected(e.target.value)} aria-label="Sub-account"
              className="mt-1 max-w-full rounded-lg bg-transparent text-sm text-muted outline-none hover:text-fg">
              {sa.items.map((s) => <option key={s.id} value={s.id} className="bg-panel">{s.name}</option>)}
            </select>
          ) : (
            <p className="mt-1 truncate text-sm text-muted">{sa.current?.name || (sa.loading ? 'Loading…' : 'No sub-account')}</p>
          )}
        </div>
      </header>

      <div className="mt-6 grid flex-1 gap-8 lg:grid-cols-[1fr_380px]">
        {/* Voice column */}
        <section className="flex flex-col items-center">
          <div className="w-full">
            <div className="h-px w-2/3 bg-gradient-to-r from-line via-faint to-transparent" />
            <p aria-live="polite" className="px-2 py-5 text-center text-[17px] font-medium">
              {working ? <span className="text-cyan">{working}…</span> : status}{!working && phase === 'idle' && status.startsWith('Hi,') && ' 👋'}
            </p>
            <div className="ml-auto h-px w-2/3 bg-gradient-to-l from-line via-faint to-transparent" />
          </div>

          <div className="my-6 flex flex-1 items-center justify-center sm:my-10">
            <Orb state={orbState} size={260} />
          </div>

          {showType && (
            <form onSubmit={send} className="mb-6 w-full max-w-md">
              <label htmlFor="typed" className={`mb-2 block text-sm font-medium ${ask ? 'text-cyan' : 'text-muted'}`}>
                {ask ? ask.label : 'Prefer typing? Enter an email, phone or name'}
              </label>
              <div className="flex gap-2">
                <input id="typed" ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)}
                  type={kind === 'email' ? 'email' : kind === 'phone' ? 'tel' : 'text'}
                  inputMode={kind === 'email' ? 'email' : kind === 'phone' ? 'tel' : 'text'}
                  autoComplete="off" spellCheck={false} placeholder={PLACEHOLDER[kind]}
                  className={`h-12 min-w-0 flex-1 rounded-2xl border bg-card px-4 text-[15px] outline-none transition placeholder:text-faint focus:border-cyan focus:ring-3 focus:ring-cyan/20 ${ask ? 'border-cyan ring-3 ring-cyan/20' : 'border-line'}`} />
                <button aria-label="Send to Nova" className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-cyan text-cyan-ink hover:bg-[#7ddcf7]">
                  <IconSend size={20} />
                </button>
              </div>
              <p aria-live="polite" className={`mt-2 min-h-5 text-sm ${hint?.bad ? 'text-bad' : 'text-muted'}`}>{hint?.text}</p>
            </form>
          )}

          {/* Controls: keyboard · mic · close */}
          <div className="flex w-full max-w-sm items-center justify-between pb-2">
            <button onClick={() => setTypeOpen((o) => !o)} disabled={phase !== 'live'} aria-pressed={typeOpen}
              aria-label="Type instead" title="Type instead"
              className={`flex size-14 items-center justify-center rounded-full transition disabled:opacity-35 ${typeOpen ? 'bg-cyan/15 text-cyan' : 'bg-card text-fg hover:bg-card-2'}`}>
              <IconKeyboard size={24} />
            </button>

            <div className="flex flex-col items-center gap-2">
              <div className="rounded-full bg-card/60 p-3.5">
                <button onClick={onMic} disabled={phase === 'connecting' || (phase === 'idle' && !sa.selected)}
                  data-live={phase === 'live' && !muted}
                  aria-label={phase === 'idle' ? 'Start talking' : muted ? 'Unmute' : 'Mute'}
                  className={`mic-ring relative flex size-24 items-center justify-center rounded-full transition disabled:cursor-wait disabled:opacity-60 ${
                    phase === 'live' && !muted ? 'bg-cyan text-cyan-ink' : 'bg-card-2 text-fg hover:bg-[#383a40]'
                  }`}>
                  {muted ? <IconMicOff size={36} /> : <IconMic size={36} />}
                </button>
              </div>
              <span className="text-xs text-muted">
                {phase === 'idle' ? 'Tap to talk' : phase === 'connecting' ? 'Connecting…' : muted ? 'Tap to unmute' : 'Tap to mute'}
              </span>
            </div>

            <button onClick={onClose} aria-label={phase === 'idle' ? 'Close' : 'End call'} title={phase === 'idle' ? 'Close' : 'End call'}
              className={`flex size-14 items-center justify-center rounded-full transition ${phase !== 'idle' ? 'bg-bad text-white hover:bg-[#ef5b5b]' : 'bg-card text-fg hover:bg-card-2'}`}>
              <IconX size={24} />
            </button>
          </div>
        </section>

        {/* This call's activity */}
        <aside className="rounded-[28px] border border-line bg-panel p-5">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">This call</h2>
            <Link href="/history" className="text-sm text-muted hover:text-fg">History</Link>
          </div>
          {items.length ? (
            <ul className="space-y-2.5">{items.map((a, i) => <ActivityItem key={a.id} item={a} meta={false} fresh={i === 0} when="time" />)}</ul>
          ) : (
            <p className="rounded-2xl bg-card p-5 text-[15px] leading-relaxed text-muted">
              {phase === 'live' ? 'Ask Nova to do something.' : 'Start a call.'} Each change Nova makes shows up here, e.g.{' '}
              <span className="text-fg">Tag <span className="text-cyan">VIP</span> added to contact <span className="text-cyan">John Smith</span></span>.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
