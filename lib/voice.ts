'use client';
// Browser side of a Nova call: loads the Voximplant Web SDK, logs in with a one-time key
// (the password stays on the server), calls the scenario and relays its messages.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Activity } from '@/lib/types';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/voximplant-websdk@4.14.0-3018/voximplant.min.js';

export type AskKind = 'email' | 'phone' | 'text';

export interface CallHandlers {
  onConnected(): void;
  onEnded(reason: string): void;
  onActivity(item: Activity): void;
  onAsk(kind: AskKind, label: string): void;
  onReceived(value: string): void;
}

interface StartInfo { sessionToken: string; subaccountName: string; node: string; callNumber: string; usernames: string[] }

let sdkPromise: Promise<any> | null = null;
function loadSdk(): Promise<any> {
  const w = window as any;
  if (w.VoxImplant) return Promise.resolve(w.VoxImplant);
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SDK_URL;
      s.async = true;
      s.onload = () => resolve(w.VoxImplant);
      s.onerror = () => { sdkPromise = null; reject(new Error('Could not load the call SDK. Check your connection.')); };
      document.head.appendChild(s);
    });
  }
  return sdkPromise;
}

async function postJson(url: string, body: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Request failed (' + r.status + ')');
  return d;
}

let initialized = false;

async function loginOneTime(sdk: any, username: string) {
  let key: string | undefined;
  try {
    const r = await sdk.requestOneTimeLoginKey(username);
    key = r && r.key;
  } catch (e: any) {
    // The SDK reports the key as an AuthResult with code 302, which can arrive as a rejection
    if (e && e.key) key = e.key;
    else throw e;
  }
  if (!key) throw new Error('Voximplant did not return a login key');
  const { hash } = await postJson('/api/vox/hash', { key });
  await sdk.loginWithOneTimeKey(username, hash);
}

async function ensureLoggedIn(Vox: any, info: StartInfo) {
  const sdk = Vox.getInstance();
  const S = Vox.ClientState;
  if (!initialized) {
    await sdk.init({ node: Vox.ConnectionNode[info.node], micRequired: true });
    initialized = true;
  }
  if (sdk.getClientState() === S.LOGGED_IN) return sdk;
  if (sdk.getClientState() === S.DISCONNECTED) await sdk.connect();
  let last: unknown;
  for (const u of info.usernames) {
    try { await loginOneTime(sdk, u); return sdk; } catch (e) { last = e; }
  }
  throw last;
}

export class NovaCall {
  private call: any = null;
  private Vox: any = null;
  private ended = false;
  subaccountName = '';

  constructor(private h: CallHandlers) {}

  get active() { return !!this.call; }

  async start(subaccountId: string) {
    const info: StartInfo = await postJson('/api/call/start', { subaccountId });
    this.subaccountName = info.subaccountName;
    this.Vox = await loadSdk();
    const sdk = await ensureLoggedIn(this.Vox, info);
    const E = this.Vox.CallEvents;
    const call = sdk.call({
      number: info.callNumber,
      video: { sendVideo: false, receiveVideo: false },
      customData: JSON.stringify({ s: info.sessionToken })
    });
    this.call = call;
    this.ended = false;
    call.on(E.Connected, () => this.h.onConnected());
    call.on(E.Disconnected, () => this.finish('ended'));
    call.on(E.Failed, (e: any) => this.finish('failed' + (e && e.code ? ' (code ' + e.code + ')' : '')));
    call.on(E.MessageReceived, (e: any) => this.onMessage(e.text));
  }

  private finish(reason: string) {
    if (this.ended) return;
    this.ended = true;
    this.call = null;
    this.h.onEnded(reason);
  }

  private onMessage(text: string) {
    let m: any = null;
    try { m = JSON.parse(text); } catch { return; }
    if (!m) return;
    if (m.type === 'activity' && m.item) {
      this.h.onActivity({ id: 'live-' + Date.now() + Math.random(), created_at: new Date().toISOString(), ...m.item });
    } else if (m.type === 'ask') {
      this.h.onAsk((['email', 'phone', 'text'].includes(m.kind) ? m.kind : 'text') as AskKind, m.label || '');
    } else if (m.type === 'received') {
      this.h.onReceived(String(m.value || ''));
    }
  }

  hangup() {
    try { this.call?.hangup(); } catch { this.finish('ended'); }
  }

  setMuted(on: boolean) {
    try { on ? this.call?.muteMicrophone() : this.call?.unmuteMicrophone(); } catch { /* ignore */ }
  }

  sendTyped(kind: AskKind, value: string) {
    if (!this.call) throw new Error('No active call');
    this.call.sendMessage(JSON.stringify({ type: 'typed', kind, value }));
  }
}

export function guessKind(v: string): AskKind {
  if (/@/.test(v)) return 'email';
  if (/^[+()\d\s.-]{7,}$/.test(v)) return 'phone';
  return 'text';
}

// Returns an error message, or '' if the value looks fine
export function validateTyped(kind: AskKind, v: string) {
  if (kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return 'That email looks incomplete. Check it and send again.';
  if (kind === 'phone' && v.replace(/\D/g, '').length < 7) return 'That number looks too short. Include the area code.';
  return '';
}
