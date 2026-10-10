'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import FollowupComposer, { type Channel, type ChannelState, type Draft } from '@/components/FollowupComposer';
import FollowupHistory from '@/components/FollowupHistory';
import { useSubaccounts } from '@/lib/useSubaccounts';
import { IconBack, IconSearch, IconSend, IconSparkle, IconChat, IconUser } from '@/components/Icons';

interface Contact { id: string; name: string; email: string; phone: string; tags: string[]; company: string }
interface Msg { at: string; when: string; day: string; who: 'Lead' | 'Team' | 'System'; channel: string; text: string }
interface Detail {
  contact: Contact; summary: string; messages: Msg[]; messageCount: number; channels: string[]; note?: string;
  states: Record<Channel, ChannelState>; followup: Partial<Draft> | null; senderName: string;
}
interface QA { q: string; a?: string; error?: boolean }

const field = 'h-12 w-full rounded-2xl border border-line bg-card px-4 text-[15px] text-fg placeholder:text-faint outline-none transition focus:border-cyan focus:ring-3 focus:ring-cyan/20';

// Renders Gemini's plain-text summary: heading lines + "- " bullets
function Summary({ text }: { text: string }) {
  const blocks: { title?: string; items: string[] }[] = [];
  for (const raw of text.replace(/\*\*/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[-•*]\s+/.test(line)) {
      if (!blocks.length) blocks.push({ items: [] });
      blocks[blocks.length - 1].items.push(line.replace(/^[-•*]\s+/, ''));
    } else {
      blocks.push({ title: line.replace(/:$/, ''), items: [] });
    }
  }
  return (
    <div className="space-y-4">
      {blocks.map((b, i) => (
        <div key={i}>
          {b.title && <h4 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-cyan">{b.title}</h4>}
          {b.items.length > 0 && (
            <ul className="space-y-1.5">
              {b.items.map((it, j) => (
                <li key={j} className="flex gap-2.5 text-[15px] leading-relaxed text-fg">
                  <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-cyan" />{it}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

export default function LeadsPage() {
  return <Suspense><Leads /></Suspense>;
}

function Leads() {
  const sa = useSubaccounts();
  const params = useSearchParams();
  const deepLink = useRef<{ sa: string; contact: string } | null>(
    params.get('contact') ? { sa: params.get('sa') || '', contact: params.get('contact') || '' } : null
  );
  const [sentVersion, setSentVersion] = useState(0);
  const [q, setQ] = useState('');
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [listError, setListError] = useState('');
  const [picked, setPicked] = useState<Contact | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [chat, setChat] = useState<QA[]>([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [showConvo, setShowConvo] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);

  // Contact search (debounced); empty search = recently updated contacts
  useEffect(() => {
    if (!sa.selected) return;
    const t = setTimeout(async () => {
      setContacts(null); setListError('');
      try {
        const r = await fetch('/api/leads/contacts?' + new URLSearchParams({ subaccount: sa.selected, q }), { cache: 'no-store' });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Could not load contacts');
        setContacts(d.items);
      } catch (e) { setListError((e as Error).message); setContacts([]); }
    }, q ? 350 : 0);
    return () => clearTimeout(t);
  }, [sa.selected, q]);

  // Reset when switching sub-account; then open a contact from a notification link (?sa=&contact=)
  useEffect(() => {
    setPicked(null); setDetail(null); setChat([]);
    const link = deepLink.current;
    if (!link || !sa.selected) return;
    if (link.sa && link.sa !== sa.selected && sa.items.some((s) => s.id === link.sa)) { sa.setSelected(link.sa); return; }
    deepLink.current = null;
    open({ id: link.contact, name: 'Loading…', email: '', phone: '', tags: [], company: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sa.selected, sa.items]);

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [chat]);

  async function open(c: Contact) {
    setPicked(c); setDetail(null); setError(''); setChat([]); setShowConvo(false); setLoading(true);
    try {
      const r = await fetch('/api/leads/summary', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subaccountId: sa.selected, contactId: c.id })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not summarize');
      setDetail(d);
      if (d.contact) setPicked(d.contact);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  async function ask(e?: React.FormEvent) {
    e?.preventDefault();
    const text = question.trim();
    if (!text || !picked || asking) return;
    const history = chat.filter((x) => x.a && !x.error).map((x) => ({ q: x.q, a: x.a }));
    setChat((c) => [...c, { q: text }]);
    setQuestion(''); setAsking(true);
    try {
      const r = await fetch('/api/leads/ask', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subaccountId: sa.selected, contactId: picked.id, question: text, history })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not answer');
      setChat((c) => c.map((x, i) => (i === c.length - 1 ? { ...x, a: d.answer } : x)));
    } catch (err) {
      setChat((c) => c.map((x, i) => (i === c.length - 1 ? { ...x, a: (err as Error).message, error: true } : x)));
    } finally { setAsking(false); }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[30px] font-semibold tracking-tight">Leads</h1>
          <p className="mt-1 text-[15px] text-muted">AI summary of any contact&apos;s conversation, and answers to your questions about it.</p>
        </div>
        {sa.items.length > 1 && (
          <select value={sa.selected} onChange={(e) => sa.setSelected(e.target.value)} aria-label="Sub-account"
            className="h-11 rounded-2xl border border-line bg-card px-3.5 text-[15px] outline-none focus:border-cyan">
            {sa.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>

      {!sa.loading && !sa.items.length && (
        <Link href="/subaccounts" className="mt-6 block rounded-2xl border border-dashed border-line p-6 text-center text-muted hover:text-fg">
          Add a sub-account first to see its leads.
        </Link>
      )}

      {sa.selected && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[340px_1fr]">
          {/* Contact list */}
          <section className={picked ? 'hidden lg:block' : ''}>
            <label className="relative block">
              <span className="sr-only">Search contacts</span>
              <IconSearch size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email or phone number" className={field + ' pl-11'} inputMode="search" />
            </label>
            <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted">
              {q ? (/@/.test(q) ? 'Email match' : /^[+()\d\s.-]{7,}$/.test(q) ? 'Phone match' : 'Results') : 'Recently updated'}
            </p>
            {listError && <p className="rounded-2xl bg-bad/10 px-4 py-3 text-sm text-bad">{listError}</p>}
            <ul className="space-y-2">
              {contacts === null && [0, 1, 2, 3].map((i) => <li key={i} className="h-16 animate-pulse rounded-2xl bg-card" />)}
              {contacts?.map((c) => (
                <li key={c.id}>
                  <button onClick={() => open(c)}
                    className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left transition ${picked?.id === c.id ? 'bg-cyan/12 ring-1 ring-cyan/40' : 'bg-card hover:bg-card-2'}`}>
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-card-2 text-sm font-semibold text-cyan">
                      {c.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || <IconUser size={18} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-medium">{c.name}</span>
                      <span className="block truncate text-xs text-muted">{c.email || c.phone || 'No email or phone'}</span>
                    </span>
                  </button>
                </li>
              ))}
              {contacts && !contacts.length && !listError && <li className="rounded-2xl bg-card p-5 text-center text-sm text-muted">No contacts found.</li>}
            </ul>
          </section>

          {/* Detail */}
          <section className={picked ? '' : 'hidden lg:block'}>
            {!picked ? (
              <div className="flex h-full min-h-72 flex-col items-center justify-center rounded-[28px] border border-dashed border-line p-8 text-center text-muted">
                <IconSparkle size={28} className="mb-3 text-cyan" />
                Pick a contact to get an AI summary of their conversation.
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex items-start gap-3">
                  <button onClick={() => setPicked(null)} aria-label="Back to contacts"
                    className="flex size-11 shrink-0 items-center justify-center rounded-full bg-card hover:bg-card-2 lg:hidden"><IconBack size={20} /></button>
                  <div className="min-w-0 flex-1 rounded-[24px] bg-card p-5">
                    <h2 className="text-xl font-semibold">{picked.name}</h2>
                    <p className="mt-1 text-sm text-muted">{[picked.email, picked.phone, picked.company].filter(Boolean).join(' · ') || 'No contact details'}</p>
                    {picked.tags.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {picked.tags.map((t) => <span key={t} className="rounded-full bg-card-2 px-2.5 py-0.5 text-xs text-fg">{t}</span>)}
                      </div>
                    )}
                    {detail && (
                      <p className="mt-3 text-xs text-muted">
                        {detail.messageCount} message{detail.messageCount === 1 ? '' : 's'}{detail.channels.length ? ' · ' + detail.channels.join(', ') : ''}
                      </p>
                    )}
                  </div>
                </div>

                <div className="rounded-[24px] border border-line bg-panel p-5 sm:p-6">
                  <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold"><IconSparkle size={18} className="text-cyan" /> Lead summary</h3>
                  {loading && (
                    <div className="flex items-center gap-3 py-6 text-muted">
                      <span className="size-5 animate-spin rounded-full border-2 border-line border-t-cyan" />
                      Pulling the conversation and summarizing…
                    </div>
                  )}
                  {error && (
                    <div className="rounded-2xl bg-bad/10 px-4 py-3 text-sm text-bad">
                      {error} <button onClick={() => open(picked)} className="ml-2 underline">Try again</button>
                    </div>
                  )}
                  {detail && (detail.summary ? <Summary text={detail.summary} /> : <p className="text-muted">{detail.note || 'Nothing to summarize.'}</p>)}
                </div>

                {detail && detail.states && (
                  <FollowupComposer key={detail.contact.id} subaccountId={sa.selected} contactId={detail.contact.id}
                    contactName={detail.contact.name} senderName={detail.senderName} states={detail.states}
                    draft={detail.followup ? { short: '', email_subject: '', email_body: '', ...detail.followup } : null}
                    lastLeadChannel={[...detail.messages].reverse().find((m) => m.who === 'Lead')?.channel}
                    onSent={() => setSentVersion((v) => v + 1)} />
                )}

                {detail && detail.messageCount > 0 && (
                  <div className="rounded-[24px] border border-line bg-panel p-5 sm:p-6">
                    <h3 className="mb-3 text-lg font-semibold">Ask about this lead</h3>
                    <div className="space-y-3">
                      {chat.map((x, i) => (
                        <div key={i} className="space-y-2">
                          <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-cyan px-4 py-2.5 text-[15px] text-cyan-ink">{x.q}</p>
                          {x.a ? (
                            <p className={`w-fit max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-bl-md px-4 py-2.5 text-[15px] ${x.error ? 'bg-bad/10 text-bad' : 'bg-card text-fg'}`}>{x.a}</p>
                          ) : (
                            <p className="w-fit rounded-2xl rounded-bl-md bg-card px-4 py-2.5 text-[15px] text-muted">Thinking…</p>
                          )}
                        </div>
                      ))}
                      <div ref={chatEnd} />
                    </div>
                    {!chat.length && (
                      <div className="mb-3 flex flex-wrap gap-2">
                        {['When did they share their email?', 'What are they asking for?', 'Did we send them a quote?'].map((s) => (
                          <button key={s} onClick={() => setQuestion(s)} className="rounded-full bg-card px-3.5 py-1.5 text-sm text-muted hover:bg-card-2 hover:text-fg">{s}</button>
                        ))}
                      </div>
                    )}
                    <form onSubmit={ask} className="mt-3 flex gap-2">
                      <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask something specific…" className={field} disabled={asking} />
                      <button disabled={asking || !question.trim()} aria-label="Ask"
                        className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-cyan text-cyan-ink hover:bg-[#7ddcf7] disabled:opacity-50">
                        <IconSend size={20} />
                      </button>
                    </form>
                  </div>
                )}

                {detail && <FollowupHistory subaccountId={sa.selected} contactId={detail.contact.id} version={sentVersion} />}

                {detail && detail.messages.length > 0 && (
                  <div className="rounded-[24px] border border-line bg-panel p-5 sm:p-6">
                    <button onClick={() => setShowConvo((s) => !s)} className="flex w-full items-center justify-between text-lg font-semibold">
                      <span className="flex items-center gap-2"><IconChat size={18} className="text-cyan" /> Conversation</span>
                      <span className="text-sm font-normal text-muted">{showConvo ? 'Hide' : 'Show'}</span>
                    </button>
                    {showConvo && (
                      <div className="mt-4 max-h-[60vh] space-y-2 overflow-y-auto pr-1">
                        {detail.messages.map((m, i) => (
                          <div key={i}>
                            {(i === 0 || detail.messages[i - 1].day !== m.day) && (
                              <p className="my-3 text-center text-xs font-semibold uppercase tracking-wide text-faint">{m.day}</p>
                            )}
                            <div className={`max-w-[88%] rounded-2xl px-4 py-2.5 ${m.who === 'Lead' ? 'bg-card' : m.who === 'Team' ? 'ml-auto bg-cyan/12' : 'mx-auto bg-transparent text-center'}`}>
                              <p className="mb-0.5 text-xs text-muted">{m.who} · {m.channel} · {m.when.split(', ').pop()}</p>
                              <p className="whitespace-pre-wrap text-[14.5px] text-fg">{m.text}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
