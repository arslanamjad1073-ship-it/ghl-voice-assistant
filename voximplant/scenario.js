// Nova - CRM voice assistant (Gemini Live) for the Nova web app.
// Answers a web call, asks "What can I do for you?", and works inside one GHL sub-account.
//
// v3 (web app):
//  - The sub-account (location, GHL token, timezone, currency...) is loaded per call from the web app,
//    using the session token the browser passes in customData. One scenario serves every sub-account.
//  - After each CRM change Nova reports an activity, e.g. Tag "VIP" added to contact "John Smith".
//    It is sent live to the browser (call message) and saved to the history (web app -> Supabase).
//  - Calls without a session token (e.g. the old GHL widget) fall back to the LEGACY settings below.
//
// Voximplant Secrets:
//   GEMINI_API_KEY   Gemini API key
//   APP_BASE_URL     your Vercel URL, e.g. https://nova.vercel.app
//   SCENARIO_SECRET  same value as SCENARIO_SECRET in Vercel
//   GHL_TOKEN        (legacy only) token for calls from the old GHL widget
//   NOTIFY_WEBHOOK_URL (legacy only)
// Routing: rule ^crm$ above the .* rule, this scenario attached.

require(Modules.Gemini);

const GHL_BASE = 'https://services.leadconnectorhq.com';
// Model: '25' = gemini-2.5-flash-native-audio (stable, free tier), '31' = gemini-3.1-flash-live-preview
const MODEL_CHOICE = '25';
const GEMINI_MODEL = MODEL_CHOICE === '31' ? 'gemini-3.1-flash-live-preview' : 'gemini-2.5-flash-native-audio-preview-12-2025';
const GEMINI_VOICE = 'Aoede';
// Set to false to test plain conversation without CRM tools (helps isolate problems)
const TOOLS_ENABLED = true;
// 2.5 native audio: thinking makes the model sometimes emit a broken tool call ("<ctrl46>") instead of
// running the tool. 0 turns thinking off. If Gemini ever rejects the setup because of it, set to null.
const THINKING_BUDGET_25 = 0;

// Used only for calls that arrive without a web-app session token (the old GHL widget)
const LEGACY = {
  locationId: '41rKO5avlbp10R9mXruI',
  tzOffsetHours: 5, tzName: 'Asia/Karachi', tzLabel: 'PKT',
  currency: 'USD', invoiceLiveMode: true, invoiceSenderName: ''
};

// ---------- per-call settings (filled by loadSession) ----------
let GHL_LOCATION_ID = LEGACY.locationId;
let GHL_TOKEN = '';
let TZ_OFFSET_HOURS = LEGACY.tzOffsetHours;
let TZ_NAME = LEGACY.tzName;
let TZ_LABEL = LEGACY.tzLabel;
let INVOICE_CURRENCY = LEGACY.currency;
let INVOICE_LIVE_MODE = LEGACY.invoiceLiveMode;   // false = test mode (no real payments)
let INVOICE_SENDER_NAME = LEGACY.invoiceSenderName; // '' = first admin user
let NOTIFY_WEBHOOK_URL = '';
let SUBACCOUNT_NAME = '';
let USER_NAME = '';
let SESSION_TOKEN = '';
let APP_BASE_URL = '';
let SCENARIO_SECRET = '';
let activeCall = null;

function secret(name) {
  try { return VoxEngine.getSecretValue(name) || ''; } catch (e) { return ''; }
}

const pad = (n) => (n < 10 ? '0' : '') + n;
function offsetStr() {
  const a = Math.abs(TZ_OFFSET_HOURS), h = Math.floor(a), m = Math.round((a - h) * 60);
  return (TZ_OFFSET_HOURS < 0 ? '-' : '+') + pad(h) + ':' + pad(m);
}

// Loads the sub-account settings for this call from the web app
async function loadSession(customData) {
  let token = '';
  try { const cd = JSON.parse(customData || '{}'); token = cd.s || cd.session || ''; } catch (e) {}
  if (!token) {
    Logger.write('No session token: legacy mode (location ' + GHL_LOCATION_ID + ')');
    NOTIFY_WEBHOOK_URL = secret('NOTIFY_WEBHOOK_URL');
    return;
  }
  APP_BASE_URL = secret('APP_BASE_URL').replace(/\/+$/, '');
  SCENARIO_SECRET = secret('SCENARIO_SECRET');
  if (!APP_BASE_URL || !SCENARIO_SECRET) throw new Error('APP_BASE_URL or SCENARIO_SECRET secret is missing');
  const res = await Net.httpRequestAsync(APP_BASE_URL + '/api/scenario/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SCENARIO_SECRET },
    postData: JSON.stringify({ token: token }),
    timeout: 10
  });
  Logger.write('Session lookup -> ' + res.code);
  if (res.code !== 200) throw new Error('Session lookup failed (' + res.code + '): ' + String(res.text || '').slice(0, 150));
  const s = JSON.parse(res.text || '{}');
  SESSION_TOKEN = token;
  GHL_LOCATION_ID = s.location_id;
  GHL_TOKEN = s.ghl_token;
  TZ_NAME = s.timezone || 'UTC';
  TZ_OFFSET_HOURS = Number(s.tz_offset_hours) || 0;
  TZ_LABEL = s.tz_label || TZ_NAME;
  INVOICE_CURRENCY = s.currency || 'USD';
  INVOICE_LIVE_MODE = s.invoice_live_mode !== false;
  INVOICE_SENDER_NAME = s.invoice_sender_name || '';
  NOTIFY_WEBHOOK_URL = s.notify_webhook_url || '';
  SUBACCOUNT_NAME = s.subaccount_name || '';
  USER_NAME = s.user_name || '';
  Logger.write('Session: ' + SUBACCOUNT_NAME + ' (' + GHL_LOCATION_ID + '), user ' + USER_NAME + ', tz ' + TZ_NAME + ' ' + offsetStr());
}

function buildInstructions() {
  return `
You are Nova, the CRM voice copilot for our team. Speak short, clear English.
Start by saying: "Hi, I'm Nova. What can I do for you today?"` +
  (USER_NAME ? `\nYou are talking with ${USER_NAME}, a member of our team.` : '') +
  (SUBACCOUNT_NAME ? `\nYou are working in the "${SUBACCOUNT_NAME}" account.` : '') + `
You can: find contacts, read contact details, add or remove tags, update contact fields (standard and custom),
create opportunities, move opportunities between stages, change opportunity status (open, won, lost, abandoned) and value,
read a contact's conversation history, check, book, reschedule and cancel appointments, add notes,
add tasks assigned to a team member, send SMS or email to a contact, create and send invoices,
and send internal notifications to team members.
Each completed change is also shown on the user's screen as an activity list.
Typed input (the app has a text box):
- Messages that start with [TYPED BY USER] were typed, not spoken. Treat that text as exactly correct: use it character for character
  (for find_contact queries, emails, phone numbers, names). Do not "correct" its spelling. Briefly confirm what you received.
- Spoken emails and phone numbers are often misheard. Whenever you need an email address or phone number, first call
  request_typed_input with kind "email" or "phone" and say: "You can say it, or type it in the box on your screen."
- If you do take a spoken email or phone number, spell it back character by character and ask "Is that right?".
  If the user corrects you, or it still sounds unclear, call request_typed_input and ask them to type it.
- For hard-to-hear names you can also call request_typed_input with kind "text".
Rules:
- Always use find_contact first to get the contact_id. Search by name, email, or phone.
- If several contacts match, read out the names with email or phone and ask which one.
- Before ANY change (add_tag, remove_tag, update_contact_field, create_opportunity, move_opportunity, update_opportunity,
  add_note, add_task, send_sms, send_email, book_appointment, reschedule_appointment, cancel_appointment,
  create_invoice, notify_team_member), repeat exactly what you will do and ask "Should I go ahead?". Only act after a clear yes.
- If the user is unsure of a pipeline or stage name, use list_pipeline_stages and read the options.
- If the user is unsure of a field name, use list_contact_fields and read the closest options.
- Opportunities: to mark won or lost or change the deal value, use update_opportunity. To change stage, use move_opportunity.
- Conversations: when asked about a contact's messages (for example "did they send us the quote?",
  "did they reply?", "what did they ask for?"), call get_conversation, then answer ONLY from those messages.
  Say who said it (the contact or our team) and roughly when. If the messages don't answer it, say so plainly.
  Do not read the whole conversation aloud unless asked; summarize briefly.
- Appointments:
  * To see a contact's appointments use get_appointments. Say upcoming ones first with day, date and time.
  * To BOOK: find the contact, then ask which calendar (use list_calendars if there is more than one and the user is unsure),
    then ask for a preferred day. Call check_availability and read up to 5 open times. Never book a time that was not offered
    unless the user insists. Confirm contact, calendar, day and time, then call book_appointment.
  * To RESCHEDULE: call get_appointments, confirm which appointment, check_availability on its calendar for the new day,
    confirm the new time, then call reschedule_appointment with the appointment_id.
  * To CANCEL: call get_appointments, confirm which appointment by day and time, then call cancel_appointment.
  * Convert words like "tomorrow" or "next Monday" into date (YYYY-MM-DD) and time as HH:MM 24-hour, using today's date below.
- Invoices: ask for everything needed, one question at a time:
  1) which contact, 2) each item: what it is (name), quantity, and price per unit, 3) ask "Anything else to add?" until done,
  4) due date (default 7 days from today if they say "standard"), 5) any note for the customer (optional),
  6) send by email, SMS, or both (or "don't send" to keep it as a draft).
  Then read back every item, the total, the due date and how it will be sent, and ask "Should I go ahead?".
  Only then call create_invoice once with all items. Default currency is ${INVOICE_CURRENCY}; if the user names
  another currency (for example PKR), pass it as currency (3-letter code).
- Internal notifications: ask which team member (use list_users if unsure), what the message is, and whether by email, SMS, or both.
  If it is about a contact, include the contact_id. Read the message back before sending.
- Notes: write the note in clean, complete sentences based on what the user said. Read it back briefly before saving.
- Tasks: get a short title and a due date. Convert words like "tomorrow" or "next Monday" into due_date (YYYY-MM-DD)
  using today's date below. If no time is given, use 10:00.
  Always ask which team member the task should be assigned to. Use list_users to read the names if the user
  is unsure. Pass the chosen name as assignee. Confirm title, due day and assignee before creating it.
- SMS and email: these go to a real customer, so be careful. Write the message from what the user said,
  read the FULL text back (and the subject for email), and only send after a clear yes.
  Keep SMS short (under 300 characters). For email, write a short professional message with a subject.
- Read dates naturally, like "Tuesday the 6th at 3 PM", not raw timestamps. Read money naturally, like "two hundred fifty dollars".
- When the user says yes to a change, call the tool IMMEDIATELY in that same turn. In the same breath say a short line
  first, like "Okay, creating the invoice now, one moment." Never go silent and never wait for the user to ask again.
- After every tool result, ALWAYS speak right away: say what happened using the "say" field of the result
  (for example "Done. Invoice number 12 for PKR 2,000 was sent to Peter John by email and SMS."), then ask "Anything else?".
- NEVER say something was created, sent, booked, updated or added unless you received a tool result with ok: true for it.
  If you are not sure it happened, say so and call the tool. Do not guess.
- If a tool returns an error, explain it simply and offer what to do next.
- Ask "Anything else?" after each task. When the user is done, say goodbye and call hangup_call.
Never invent contacts, tags, fields, stages, messages, appointments, calendars, or prices. Only use tool results and what the user said.`
  + '\nToday is ' + fmtTime(new Date().toISOString()) + ' (' + todayLocal() + ').';
}

const IS31 = MODEL_CHOICE === '31';
// 3.1 uses JSON Schema (parametersJsonSchema); 2.5 uses the classic Gemini schema (parameters, uppercase types)
const S = IS31 ? { type: 'string' } : { type: 'STRING' };
const N = IS31 ? { type: 'number' } : { type: 'NUMBER' };
const E = (values) => IS31 ? { type: 'string', enum: values } : { type: 'STRING', enum: values };
const OBJ = (props, required) => IS31
  ? { type: 'object', properties: props, required: required || [] }
  : { type: 'OBJECT', properties: props, required: required || [] };
const ARR = (items) => IS31 ? { type: 'array', items: items } : { type: 'ARRAY', items: items };
const p = (props, required) => IS31
  ? { type: 'object', properties: props, required: required || [] }
  : (Object.keys(props).length ? { type: 'OBJECT', properties: props, required: required || [] } : undefined);
const fn = (name, description, schema) => {
  const d = { name, description };
  if (IS31) d.parametersJsonSchema = schema; else if (schema) d.parameters = schema;
  return d;
};

const FUNCTION_DECLARATIONS = [
  fn('find_contact', 'Search GHL contacts by name, email, or phone. Returns up to 5 matches.', p({ query: S }, ['query'])),
  fn('get_contact_details', 'Get all details of a contact, including custom field values and tags.', p({ contact_id: S }, ['contact_id'])),
  fn('add_tag', 'Add a tag to a contact.', p({ contact_id: S, tag: S }, ['contact_id', 'tag'])),
  fn('remove_tag', 'Remove a tag from a contact.', p({ contact_id: S, tag: S }, ['contact_id', 'tag'])),
  fn('list_contact_fields', 'List the contact fields that can be updated (standard and custom).', p({})),
  fn('update_contact_field', 'Update one contact field. field is the field name, e.g. "email", "city", or a custom field name like "Budget".',
     p({ contact_id: S, field: S, value: S }, ['contact_id', 'field', 'value'])),
  fn('list_pipeline_stages', 'List all pipelines and their stage names.', p({})),
  fn('create_opportunity', 'Create a new opportunity for a contact. pipeline_name and stage_name are optional if there is only one pipeline; stage defaults to the first stage.',
     p({ contact_id: S, name: S, pipeline_name: S, stage_name: S, monetary_value: N }, ['contact_id'])),
  fn('move_opportunity', "Move the contact's opportunity to a stage. pipeline_name only needed if the contact has opportunities in several pipelines.",
     p({ contact_id: S, stage_name: S, pipeline_name: S }, ['contact_id', 'stage_name'])),
  fn('update_opportunity', "Change the contact's opportunity status (open, won, lost, abandoned), value, and/or name. pipeline_name only needed if the contact has opportunities in several pipelines.",
     p({ contact_id: S, pipeline_name: S, status: E(['open', 'won', 'lost', 'abandoned']), monetary_value: N, name: S }, ['contact_id'])),
  fn('get_conversation', "Get the contact's recent messages (SMS, email, chat, calls) so you can answer questions about them.",
     p({ contact_id: S, max_messages: N }, ['contact_id'])),
  fn('get_appointments', "Get the contact's appointments, upcoming and past, with appointment_id for rescheduling or cancelling.", p({ contact_id: S }, ['contact_id'])),
  fn('list_calendars', 'List the calendars in this account that appointments can be booked on.', p({})),
  fn('check_availability', 'Get open booking times on a calendar. date is YYYY-MM-DD; days is how many days to check from that date (1 to 7, default 1). calendar_name optional if there is only one calendar.',
     p({ calendar_name: S, date: S, days: N }, ['date'])),
  fn('book_appointment', 'Book a new appointment for a contact. date is YYYY-MM-DD, time is HH:MM 24-hour local time.',
     p({ contact_id: S, calendar_name: S, date: S, time: S, title: S, notes: S }, ['contact_id', 'date', 'time'])),
  fn('reschedule_appointment', 'Move an existing appointment to a new date and time. appointment_id comes from get_appointments.',
     p({ appointment_id: S, date: S, time: S }, ['appointment_id', 'date', 'time'])),
  fn('cancel_appointment', 'Cancel an existing appointment. appointment_id comes from get_appointments.',
     p({ appointment_id: S }, ['appointment_id'])),
  fn('add_note', 'Add a note to a contact.', p({ contact_id: S, note: S }, ['contact_id', 'note'])),
  fn('list_users', 'List the team members (users) in this account, to assign tasks or send notifications.', p({})),
  fn('add_task', 'Add a task (follow-up) to a contact. due_date is YYYY-MM-DD, due_time is HH:MM 24-hour local time. assignee is the team member name.',
     p({ contact_id: S, title: S, details: S, due_date: S, due_time: S, assignee: S }, ['contact_id', 'title', 'due_date'])),
  fn('send_sms', 'Send an SMS text message to a contact.', p({ contact_id: S, message: S }, ['contact_id', 'message'])),
  fn('send_email', 'Send an email to a contact.', p({ contact_id: S, subject: S, message: S }, ['contact_id', 'subject', 'message'])),
  fn('create_invoice', 'Create an invoice for a contact and optionally send it. items: each has name, quantity and unit_price. due_date is YYYY-MM-DD. send_via: email, sms, both, or none (draft only).',
     p({
       contact_id: S,
       items: ARR(OBJ({ name: S, description: S, quantity: N, unit_price: N }, ['name', 'quantity', 'unit_price'])),
       due_date: S, title: S, notes: S,
       send_via: E(['email', 'sms', 'both', 'none']), currency: S
     }, ['contact_id', 'items', 'due_date', 'send_via'])),
  fn('notify_team_member', 'Send an internal notification to a team member by email, SMS, or both. contact_id optional, if the notification is about a contact.',
     p({ user_name: S, message: S, channel: E(['email', 'sms', 'both']), contact_id: S }, ['user_name', 'message'])),
  fn('request_typed_input', 'Highlight the text box in the user\'s app so they can type an email, phone number, or other text. kind: email, phone, or text. label is a short instruction shown above the box, e.g. "Type the contact\'s email".',
     p({ kind: E(['email', 'phone', 'text']), label: S }, ['kind'])),
  fn('hangup_call', 'Hang up after saying goodbye.', p({}))
];

function buildConnectConfig() {
  const cfg = {
    responseModalities: ['AUDIO'],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_VOICE } } },
    systemInstruction: { parts: [{ text: buildInstructions() }] },
    inputAudioTranscription: {},
    outputAudioTranscription: {}
  };
  if (TOOLS_ENABLED) cfg.tools = [{ functionDeclarations: FUNCTION_DECLARATIONS }];
  if (IS31) cfg.thinkingConfig = { thinkingLevel: 'minimal' };
  else if (THINKING_BUDGET_25 !== null) cfg.thinkingConfig = { thinkingBudget: THINKING_BUDGET_25 };
  return cfg;
}

// ---------------- GHL API helpers ----------------
function ghlToken() { return GHL_TOKEN || secret('GHL_TOKEN'); }

// version: calendar endpoints use 2021-04-15, everything else 2021-07-28
async function ghl(method, path, body, version) {
  const opts = {
    method,
    headers: {
      'Authorization': 'Bearer ' + ghlToken(),
      'Version': version || '2021-07-28',
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    timeout: 15
  };
  if (body) opts.postData = JSON.stringify(body);
  const res = await Net.httpRequestAsync(GHL_BASE + path, opts);
  let data = {};
  try { data = JSON.parse(res.text || '{}'); } catch (e) {}
  Logger.write('GHL ' + method + ' ' + path + ' -> ' + res.code);
  if (res.code < 200 || res.code >= 300) {
    const flat = (v) => (Array.isArray(v) ? v.map(flat).join('; ') : v && typeof v === 'object' ? JSON.stringify(v) : String(v || ''));
    let msg = data && data.message ? flat(data.message) : '';
    // Generic messages like "Unprocessable Entity Exception" hide the reason: add whatever else GHL returned
    const extra = data && (data.errors || data.error || data.details || data.meta);
    if (extra && typeof extra !== 'string') msg += (msg ? ' | ' : '') + flat(extra);
    else if (typeof extra === 'string' && extra !== msg) msg += (msg ? ' | ' : '') + extra;
    if (!msg) msg = (res.text || '').slice(0, 300);
    Logger.write('GHL error body: ' + String(res.text || '').slice(0, 1500));
    if (body) Logger.write('GHL request body: ' + JSON.stringify(body).slice(0, 1500));
    throw new Error('GHL error ' + res.code + ': ' + msg.slice(0, 400));
  }
  return data;
}
const CAL_V = '2021-04-15';

const norm = (s) => String(s || '').trim().toLowerCase();
const findByName = (list, name, key) => {
  const k = key || 'name', n = norm(name);
  return list.find((x) => norm(x[k]) === n) || list.find((x) => norm(x[k]).includes(n) || (n && n.includes(norm(x[k]))));
};

// ---------- time helpers (all in the sub-account timezone) ----------
function fmtTime(iso) {
  const t = new Date(iso);
  if (isNaN(t.getTime())) return iso || '';
  const d = new Date(t.getTime() + TZ_OFFSET_HOURS * 3600000);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let h = d.getUTCHours(); const m = d.getUTCMinutes(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return days[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + months[d.getUTCMonth()] + ' ' + d.getUTCFullYear() +
    ', ' + h + ':' + (m < 10 ? '0' : '') + m + ' ' + ap + ' ' + TZ_LABEL;
}
function localDateOf(ms) {
  const d = new Date(ms + TZ_OFFSET_HOURS * 3600000);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}
function todayLocal() { return localDateOf(Date.now()); }
// local date + time -> UTC ms
function localToMs(date, time) {
  const dm = String(date || '').match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!dm) return null;
  const tm = String(time || '00:00').match(/(\d{1,2}):(\d{2})/) || [null, '0', '00'];
  return Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2]) - TZ_OFFSET_HOURS * 3600000;
}
function msToOffsetIso(ms) {
  const d = new Date(ms + TZ_OFFSET_HOURS * 3600000);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + 'T' +
    pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':00' + offsetStr();
}
function clock(isoWithOffset) { // "2026-10-05T15:30:00+05:00" -> "3:30 PM"
  const m = String(isoWithOffset).match(/T(\d{2}):(\d{2})/);
  if (!m) return isoWithOffset;
  let h = +m[1]; const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return h + ':' + m[2] + ' ' + ap;
}

function stripHtml(t) {
  return String(t || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
}

// ---------- caches ----------
let pipelinesCache = null;
async function getPipelines() {
  if (!pipelinesCache) {
    const d = await ghl('GET', '/opportunities/pipelines?locationId=' + encodeURIComponent(GHL_LOCATION_ID));
    pipelinesCache = d.pipelines || [];
  }
  return pipelinesCache;
}

let usersCache = null;
async function getUsers() {
  if (usersCache) return usersCache;
  let list = [];
  try {
    const d = await ghl('GET', '/users/?locationId=' + encodeURIComponent(GHL_LOCATION_ID));
    list = d.users || [];
  } catch (e) {
    const loc = await getLocation();
    const d = await ghl('GET', '/users/search?companyId=' + encodeURIComponent(loc.companyId) + '&locationId=' + encodeURIComponent(GHL_LOCATION_ID) + '&limit=100');
    list = d.users || [];
  }
  usersCache = list.filter((u) => !u.deleted).map((u) => ({
    id: u.id, name: u.name || [u.firstName, u.lastName].filter(Boolean).join(' '), firstName: u.firstName || '',
    email: u.email || '', phone: u.phone || '', role: (u.roles && u.roles.role) || ''
  }));
  return usersCache;
}
async function findUser(name) {
  const users = await getUsers();
  const a = norm(name);
  return users.find((x) => norm(x.name) === a) || users.find((x) => norm(x.firstName) === a) ||
         users.find((x) => norm(x.name).includes(a) || norm(x.email) === a) || null;
}

let locationCache = null;
async function getLocation() {
  if (!locationCache) {
    const d = await ghl('GET', '/locations/' + encodeURIComponent(GHL_LOCATION_ID));
    locationCache = d.location || d;
  }
  return locationCache;
}

let customFieldsCache = null;
async function getCustomFields() {
  if (!customFieldsCache) {
    const d = await ghl('GET', '/locations/' + encodeURIComponent(GHL_LOCATION_ID) + '/customFields?model=contact');
    customFieldsCache = d.customFields || [];
  }
  return customFieldsCache;
}
// Removes empty strings, nulls and empty objects; GHL's validators reject "" for phone, URL and address fields
function dropEmpty(v) {
  if (Array.isArray(v)) return v.map(dropEmpty);
  if (v && typeof v === 'object') {
    const out = {};
    Object.keys(v).forEach((k) => {
      const x = dropEmpty(v[k]);
      if (x === '' || x === null || x === undefined) return;
      if (typeof x === 'object' && !Array.isArray(x) && !Object.keys(x).length) return;
      out[k] = x;
    });
    return out;
  }
  return typeof v === 'string' ? v.trim() : v;
}
// GHL country codes are 2 letters; contacts sometimes store a full country name
const countryCode = (c) => (/^[A-Za-z]{2}$/.test(String(c || '').trim()) ? String(c).trim().toUpperCase() : '');

const cleanKey = (k) => norm(k).replace(/^contact\./, '').replace(/[_\-]+/g, ' ');

let calendarsCache = null;
async function getCalendars() {
  if (!calendarsCache) {
    const d = await ghl('GET', '/calendars/?locationId=' + encodeURIComponent(GHL_LOCATION_ID), null, CAL_V);
    calendarsCache = (d.calendars || []).filter((c) => c.isActive !== false);
  }
  return calendarsCache;
}
async function resolveCalendar(name) {
  const cals = await getCalendars();
  if (!cals.length) return { error: { ok: false, error: 'No calendars exist in this account.' } };
  if (name) {
    const c = findByName(cals, name);
    return c ? { cal: c } : { error: { ok: false, error: 'Calendar "' + name + '" not found.', calendars: cals.map((x) => x.name) } };
  }
  if (cals.length === 1) return { cal: cals[0] };
  return { error: { ok: false, need_choice: true, error: 'Several calendars exist. Ask which one.', calendars: cals.map((x) => x.name) } };
}
function slotMinutes(cal) {
  const n = Number(cal.slotDuration) || 30;
  return /hour/i.test(cal.slotDurationUnit || '') ? n * 60 : n;
}

// Contact names seen during this call, so activities can say "contact John Smith" instead of an ID
const contactNames = {};
function rememberContact(id, name) { if (id && name) contactNames[id] = name; }

async function getContact(contact_id) {
  const d = await ghl('GET', '/contacts/' + encodeURIComponent(contact_id));
  const c = d.contact || d;
  rememberContact(c.id || contact_id, contactName(c));
  return c;
}
const contactName = (c) => [c.firstName, c.lastName].filter(Boolean).join(' ') || c.contactName || c.name || c.email || '';

async function nameOf(contact_id) {
  if (!contact_id) return '';
  if (contactNames[contact_id]) return contactNames[contact_id];
  try { const c = await getContact(contact_id); return contactName(c) || contact_id; } catch (e) { return contact_id; }
}

// Picks the contact's single opportunity (optionally within a pipeline)
async function pickOpportunity(contact_id, pipeline_name) {
  const pipelines = await getPipelines();
  const d = await ghl('GET', '/opportunities/search?location_id=' + encodeURIComponent(GHL_LOCATION_ID) +
    '&contact_id=' + encodeURIComponent(contact_id) + '&limit=20');
  let opps = d.opportunities || [];
  if (!opps.length) return { error: { ok: false, error: 'This contact has no opportunities.' } };
  if (pipeline_name) {
    const pl = findByName(pipelines, pipeline_name);
    if (!pl) return { error: { ok: false, error: 'Pipeline "' + pipeline_name + '" not found.' } };
    opps = opps.filter((o) => o.pipelineId === pl.id);
    if (!opps.length) return { error: { ok: false, error: 'No opportunity for this contact in pipeline ' + pl.name + '.' } };
  }
  if (opps.length > 1) {
    return { error: { ok: false, need_choice: true, error: 'Contact has several opportunities. Ask which pipeline.',
      opportunities: opps.map((o) => ({ name: o.name, pipeline: (pipelines.find((x) => x.id === o.pipelineId) || {}).name, status: o.status })) } };
  }
  const opp = opps[0];
  const pl = pipelines.find((x) => x.id === opp.pipelineId);
  if (!pl) return { error: { ok: false, error: 'Could not load the pipeline for this opportunity.' } };
  return { opp, pl };
}

// ---------------- Actions ----------------
const STANDARD_FIELDS = {
  'first name': 'firstName', 'firstname': 'firstName', 'last name': 'lastName', 'lastname': 'lastName',
  'name': 'name', 'full name': 'name', 'email': 'email', 'email address': 'email',
  'phone': 'phone', 'phone number': 'phone', 'address': 'address1', 'street': 'address1',
  'city': 'city', 'state': 'state', 'zip': 'postalCode', 'zip code': 'postalCode', 'postal code': 'postalCode',
  'website': 'website', 'country': 'country', 'source': 'source', 'timezone': 'timezone', 'date of birth': 'dateOfBirth', 'birthday': 'dateOfBirth'
};

const actions = {
  // ---------- contacts ----------
  async find_contact({ query }) {
    const d = await ghl('POST', '/contacts/search', { locationId: GHL_LOCATION_ID, query: query, pageLimit: 5 });
    const list = (d.contacts || []).slice(0, 5).map((c) => ({
      contact_id: c.id,
      name: [c.firstName || c.firstNameLowerCase, c.lastName || c.lastNameLowerCase].filter(Boolean).join(' ') || c.contactName || '',
      email: c.email || '',
      phone: c.phone || '',
      tags: c.tags || []
    }));
    list.forEach((c) => rememberContact(c.contact_id, c.name || c.email || c.phone));
    return list.length ? { matches: list } : { matches: [], note: 'No contact found for "' + query + '"' };
  },

  async get_contact_details({ contact_id }) {
    const c = await getContact(contact_id);
    const defs = await getCustomFields().catch(() => []);
    const custom = (c.customFields || c.customField || []).map((f) => {
      const def = defs.find((x) => x.id === f.id) || {};
      return { field: def.name || f.id, value: f.value !== undefined ? f.value : f.field_value };
    });
    return {
      contact_id: c.id, name: contactName(c),
      email: c.email || '', phone: c.phone || '', company: c.companyName || '',
      address: [c.address1, c.city, c.state, c.postalCode, c.country].filter(Boolean).join(', '),
      website: c.website || '', source: c.source || '', tags: c.tags || [], custom_fields: custom
    };
  },

  async add_tag({ contact_id, tag }) {
    await ghl('POST', '/contacts/' + encodeURIComponent(contact_id) + '/tags', { tags: [tag] });
    return { ok: true, added: tag };
  },

  async remove_tag({ contact_id, tag }) {
    await ghl('DELETE', '/contacts/' + encodeURIComponent(contact_id) + '/tags', { tags: [tag] });
    return { ok: true, removed: tag };
  },

  async list_contact_fields() {
    const defs = await getCustomFields();
    return {
      standard: ['first name', 'last name', 'email', 'phone', 'address', 'city', 'state', 'postal code', 'country', 'website', 'source', 'timezone', 'date of birth'],
      custom: defs.map((f) => ({ name: f.name, type: f.dataType, options: (f.picklistOptions || []).slice(0, 15) }))
    };
  },

  async update_contact_field({ contact_id, field, value }) {
    const key = cleanKey(field);
    const std = STANDARD_FIELDS[key];
    if (std) {
      await ghl('PUT', '/contacts/' + encodeURIComponent(contact_id), { [std]: value });
      return { ok: true, field: field, new_value: value };
    }
    const defs = await getCustomFields();
    const def = defs.find((f) => norm(f.name) === key || cleanKey(f.fieldKey) === key) ||
                defs.find((f) => norm(f.name).includes(key) || key.includes(norm(f.name)));
    if (!def) return { ok: false, error: 'No contact field called "' + field + '".', some_fields: defs.slice(0, 20).map((f) => f.name) };
    const opts = def.picklistOptions || [];
    let v = value;
    if (opts.length) {
      const match = opts.find((o) => norm(o) === norm(value)) || opts.find((o) => norm(o).includes(norm(value)));
      if (!match) return { ok: false, error: 'Value not allowed for ' + def.name + '.', allowed_values: opts };
      v = /CHECKBOX|MULTIPLE/i.test(def.dataType || '') ? [match] : match;
    } else if (/NUMERICAL|MONETORY|MONETARY/i.test(def.dataType || '')) {
      const n = parseFloat(String(value).replace(/[^0-9.\-]/g, ''));
      if (!isNaN(n)) v = n;
    }
    await ghl('PUT', '/contacts/' + encodeURIComponent(contact_id), { customFields: [{ id: def.id, field_value: v }] });
    return { ok: true, field: def.name, new_value: v };
  },

  // ---------- opportunities ----------
  async list_pipeline_stages() {
    const pls = await getPipelines();
    return { pipelines: pls.map((x) => ({ pipeline: x.name, stages: (x.stages || []).map((s) => s.name) })) };
  },

  async create_opportunity({ contact_id, name, pipeline_name, stage_name, monetary_value }) {
    const pipelines = await getPipelines();
    if (!pipelines.length) return { ok: false, error: 'No pipelines exist in this account.' };
    let pl;
    if (pipeline_name) {
      pl = findByName(pipelines, pipeline_name);
      if (!pl) return { ok: false, error: 'Pipeline "' + pipeline_name + '" not found.', pipelines: pipelines.map((x) => x.name) };
    } else if (pipelines.length === 1) {
      pl = pipelines[0];
    } else {
      return { ok: false, need_choice: true, error: 'Several pipelines exist. Ask which one.', pipelines: pipelines.map((x) => x.name) };
    }
    const stages = pl.stages || [];
    let stage = stages[0];
    if (stage_name) {
      stage = findByName(stages, stage_name);
      if (!stage) return { ok: false, error: 'Stage "' + stage_name + '" not in ' + pl.name + '.', available_stages: stages.map((s) => s.name) };
    }
    let oppName = name;
    if (!oppName) {
      try { oppName = (contactName(await getContact(contact_id)) || 'New') + ' - Opportunity'; }
      catch (e) { oppName = 'New Opportunity'; }
    }
    const body = { pipelineId: pl.id, locationId: GHL_LOCATION_ID, name: oppName, status: 'open', contactId: contact_id };
    if (stage) body.pipelineStageId = stage.id;
    if (monetary_value !== undefined && monetary_value !== null && !isNaN(Number(monetary_value))) body.monetaryValue = Number(monetary_value);
    const d = await ghl('POST', '/opportunities/', body);
    const o = d.opportunity || d;
    return { ok: true, opportunity: oppName, opportunity_id: o.id, pipeline: pl.name, stage: stage ? stage.name : '', value: body.monetaryValue };
  },

  async move_opportunity({ contact_id, stage_name, pipeline_name }) {
    const r = await pickOpportunity(contact_id, pipeline_name);
    if (r.error) return r.error;
    const stages = r.pl.stages || [];
    const stage = findByName(stages, stage_name);
    if (!stage) return { ok: false, error: 'Stage "' + stage_name + '" not in pipeline ' + r.pl.name + '.', available_stages: stages.map((s) => s.name) };
    await ghl('PUT', '/opportunities/' + encodeURIComponent(r.opp.id), { pipelineId: r.pl.id, pipelineStageId: stage.id });
    return { ok: true, opportunity: r.opp.name, pipeline: r.pl.name, new_stage: stage.name };
  },

  async update_opportunity({ contact_id, pipeline_name, status, monetary_value, name }) {
    const r = await pickOpportunity(contact_id, pipeline_name);
    if (r.error) return r.error;
    const body = {};
    if (status) {
      const s = norm(status);
      if (['open', 'won', 'lost', 'abandoned'].indexOf(s) === -1) return { ok: false, error: 'Status must be open, won, lost, or abandoned.' };
      body.status = s;
    }
    if (monetary_value !== undefined && monetary_value !== null && monetary_value !== '') {
      const n = Number(String(monetary_value).replace(/[^0-9.\-]/g, ''));
      if (isNaN(n)) return { ok: false, error: 'The value is not a number.' };
      body.monetaryValue = n;
    }
    if (name) body.name = String(name).trim();
    if (!Object.keys(body).length) return { ok: false, error: 'Nothing to change. Ask for a status, value, or name.' };
    await ghl('PUT', '/opportunities/' + encodeURIComponent(r.opp.id), body);
    return { ok: true, opportunity: body.name || r.opp.name, pipeline: r.pl.name,
      previous: { status: r.opp.status, value: r.opp.monetaryValue }, updated: body };
  },

  // ---------- conversations ----------
  async get_conversation({ contact_id, max_messages }) {
    const limit = Math.min(Math.max(parseInt(max_messages, 10) || 40, 5), 80);
    const d = await ghl('GET', '/conversations/search?locationId=' + encodeURIComponent(GHL_LOCATION_ID) +
      '&contactId=' + encodeURIComponent(contact_id) + '&limit=5');
    const convs = d.conversations || [];
    if (!convs.length) return { messages: [], note: 'No conversations found for this contact.' };

    let all = [];
    for (const cv of convs.slice(0, 3)) {
      const m = await ghl('GET', '/conversations/' + encodeURIComponent(cv.id) + '/messages?limit=' + limit);
      const list = (m.messages && Array.isArray(m.messages.messages)) ? m.messages.messages
                 : (Array.isArray(m.messages) ? m.messages : []);
      all = all.concat(list);
    }
    all.sort((x, y) => new Date(x.dateAdded) - new Date(y.dateAdded));
    const msgs = all.slice(-limit).map((x) => {
      const type = String(x.messageType || x.type || '').replace(/^TYPE_/, '').toLowerCase();
      let text = stripHtml(x.body);
      if (!text && /call/.test(type)) text = '[phone call' + (x.meta && x.meta.callStatus ? ', ' + x.meta.callStatus : '') + ']';
      if (!text && /email/.test(type)) text = '[email - body not included]';
      const files = (x.attachments || []).length;
      return {
        from: x.direction === 'inbound' ? 'contact' : 'our team',
        type: type || 'message',
        date: fmtTime(x.dateAdded),
        text: text.slice(0, 600) + (files ? ' [' + files + ' attachment' + (files > 1 ? 's' : '') + ']' : '')
      };
    });
    return { message_count: msgs.length, oldest_first: true, messages: msgs };
  },

  // ---------- appointments ----------
  async get_appointments({ contact_id }) {
    const d = await ghl('GET', '/contacts/' + encodeURIComponent(contact_id) + '/appointments');
    const cals = await getCalendars().catch(() => []);
    const now = Date.now();
    const ev = (d.events || []).map((e) => ({
      appointment_id: e.id,
      title: e.title || 'Appointment',
      calendar: (cals.find((c) => c.id === e.calendarId) || {}).name || '',
      start: e.startTime, when: fmtTime(e.startTime), ends: fmtTime(e.endTime),
      status: e.appointmentStatus || e.status || '', address: e.address || '', notes: stripHtml(e.notes).slice(0, 200)
    }));
    const upcoming = ev.filter((e) => new Date(e.start).getTime() >= now).sort((a, b) => new Date(a.start) - new Date(b.start));
    const past = ev.filter((e) => new Date(e.start).getTime() < now).sort((a, b) => new Date(b.start) - new Date(a.start)).slice(0, 5);
    const clean = (list) => list.map((e) => { const o = Object.assign({}, e); delete o.start; return o; });
    return { now: fmtTime(new Date(now).toISOString()), upcoming: clean(upcoming), recent_past: clean(past), note: ev.length ? '' : 'No appointments found.' };
  },

  async list_calendars() {
    const cals = await getCalendars();
    return { calendars: cals.map((c) => ({ name: c.name, length_minutes: slotMinutes(c) })) };
  },

  async check_availability({ calendar_name, date, days }) {
    const r = await resolveCalendar(calendar_name);
    if (r.error) return r.error;
    const startMs = localToMs(date, '00:00');
    if (startMs === null) return { ok: false, error: 'Need a date as YYYY-MM-DD.' };
    const n = Math.min(Math.max(parseInt(days, 10) || 1, 1), 7);
    const d = await ghl('GET', '/calendars/' + encodeURIComponent(r.cal.id) + '/free-slots?startDate=' + startMs +
      '&endDate=' + (startMs + n * 86400000 - 1) + '&timezone=' + encodeURIComponent(TZ_NAME), null, CAL_V);
    const out = [];
    Object.keys(d).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort().forEach((day) => {
      const slots = (d[day] && d[day].slots) || [];
      if (slots.length) out.push({ date: day, day: fmtTime(day + 'T12:00:00' + offsetStr()).split(',')[0], times: slots.slice(0, 12).map(clock), more: Math.max(0, slots.length - 12) });
    });
    return out.length ? { calendar: r.cal.name, open: out } : { calendar: r.cal.name, open: [], note: 'No open times in that range. Offer to check other days.' };
  },

  async book_appointment({ contact_id, calendar_name, date, time, title, notes }) {
    const r = await resolveCalendar(calendar_name);
    if (r.error) return r.error;
    const startMs = localToMs(date, time);
    if (startMs === null || !/\d{1,2}:\d{2}/.test(String(time))) return { ok: false, error: 'Need date as YYYY-MM-DD and time as HH:MM.' };
    if (startMs < Date.now()) return { ok: false, error: 'That time is in the past.' };
    let apptTitle = title;
    if (!apptTitle) {
      try { apptTitle = contactName(await getContact(contact_id)) + ' - ' + r.cal.name; } catch (e) { apptTitle = r.cal.name; }
    }
    const body = {
      calendarId: r.cal.id, locationId: GHL_LOCATION_ID, contactId: contact_id,
      startTime: msToOffsetIso(startMs), endTime: msToOffsetIso(startMs + slotMinutes(r.cal) * 60000),
      title: apptTitle, appointmentStatus: 'confirmed', toNotify: true
    };
    if (notes) body.notes = String(notes).trim();
    const d = await ghl('POST', '/calendars/events/appointments', body, CAL_V);
    return { ok: true, appointment_id: d.id || (d.event && d.event.id) || '', calendar: r.cal.name, when: fmtTime(body.startTime), title: apptTitle };
  },

  async reschedule_appointment({ appointment_id, date, time }) {
    const cur = await ghl('GET', '/calendars/events/appointments/' + encodeURIComponent(appointment_id), null, CAL_V);
    const ev = cur.event || cur.appointment || cur;
    const startMs = localToMs(date, time);
    if (startMs === null || !/\d{1,2}:\d{2}/.test(String(time))) return { ok: false, error: 'Need date as YYYY-MM-DD and time as HH:MM.' };
    if (startMs < Date.now()) return { ok: false, error: 'That time is in the past.' };
    let lenMs = new Date(ev.endTime).getTime() - new Date(ev.startTime).getTime();
    if (!(lenMs > 0)) lenMs = 30 * 60000;
    const body = { calendarId: ev.calendarId, startTime: msToOffsetIso(startMs), endTime: msToOffsetIso(startMs + lenMs), toNotify: true };
    await ghl('PUT', '/calendars/events/appointments/' + encodeURIComponent(appointment_id), body, CAL_V);
    return { ok: true, title: ev.title || 'Appointment', contact_id: ev.contactId || '', from: fmtTime(ev.startTime), to: fmtTime(body.startTime) };
  },

  async cancel_appointment({ appointment_id }) {
    const cur = await ghl('GET', '/calendars/events/appointments/' + encodeURIComponent(appointment_id), null, CAL_V);
    const ev = cur.event || cur.appointment || cur;
    await ghl('PUT', '/calendars/events/appointments/' + encodeURIComponent(appointment_id),
      { calendarId: ev.calendarId, appointmentStatus: 'cancelled', toNotify: true }, CAL_V);
    return { ok: true, cancelled: ev.title || 'Appointment', contact_id: ev.contactId || '', was_at: fmtTime(ev.startTime) };
  },

  // ---------- notes, users, tasks ----------
  async add_note({ contact_id, note }) {
    const text = String(note || '').trim();
    if (!text) return { ok: false, error: 'The note is empty.' };
    await ghl('POST', '/contacts/' + encodeURIComponent(contact_id) + '/notes', { body: text });
    return { ok: true, saved_note: text };
  },

  async list_users() {
    const users = await getUsers();
    return { users: users.map((u) => ({ name: u.name, email: u.email, has_phone: !!u.phone })) };
  },

  async add_task({ contact_id, title, details, due_date, due_time, assignee }) {
    const utcMs = localToMs(due_date, due_time || '10:00');
    if (utcMs === null) return { ok: false, error: 'Need a due date as YYYY-MM-DD.' };
    const dueIso = new Date(utcMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const body = { title: String(title || 'Follow up').trim(), dueDate: dueIso, completed: false };
    if (details) body.body = String(details).trim();
    let assignedName = '';
    if (assignee) {
      const u = await findUser(assignee);
      if (!u) return { ok: false, error: 'No team member called "' + assignee + '".', users: (await getUsers()).map((x) => x.name) };
      body.assignedTo = u.id; assignedName = u.name;
    }
    await ghl('POST', '/contacts/' + encodeURIComponent(contact_id) + '/tasks', body);
    return { ok: true, task: body.title, due: fmtTime(dueIso), assigned_to: assignedName || 'unassigned' };
  },

  // ---------- messages to customers ----------
  async send_sms({ contact_id, message }) {
    const text = String(message || '').trim();
    if (!text) return { ok: false, error: 'The message is empty.' };
    const d = await ghl('POST', '/conversations/messages', { type: 'SMS', contactId: contact_id, message: text });
    return { ok: true, sent: 'sms', message_id: d.messageId || d.id || '', text: text };
  },

  async send_email({ contact_id, subject, message }) {
    const text = String(message || '').trim();
    if (!text) return { ok: false, error: 'The email body is empty.' };
    const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = text.split(/\n{2,}/).map((para) => '<p>' + esc(para).replace(/\n/g, '<br>') + '</p>').join('');
    const d = await ghl('POST', '/conversations/messages', {
      type: 'Email', contactId: contact_id, subject: String(subject || 'Following up').trim(), html: html, message: text
    });
    return { ok: true, sent: 'email', message_id: d.messageId || d.id || '', subject: subject };
  },

  // ---------- invoices ----------
  async create_invoice({ contact_id, items, due_date, title, notes, send_via, currency }) {
    const CUR = /^[A-Za-z]{3}$/.test(String(currency || '').trim()) ? String(currency).trim().toUpperCase() : INVOICE_CURRENCY;
    const list = (Array.isArray(items) ? items : []).map((it) => ({
      name: String(it.name || '').trim(),
      description: String(it.description || '').trim(),
      qty: Number(it.quantity) || 1,
      amount: Number(String(it.unit_price).replace(/[^0-9.\-]/g, ''))
    })).filter((it) => it.name);
    if (!list.length) return { ok: false, error: 'No items. Ask what the invoice is for, quantity and price.' };
    const bad = list.find((it) => isNaN(it.amount) || it.amount < 0);
    if (bad) return { ok: false, error: 'Price missing or invalid for "' + bad.name + '".' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(due_date || ''))) return { ok: false, error: 'Need a due date as YYYY-MM-DD.' };
    const via = norm(send_via || 'none');

    const c = await getContact(contact_id);
    if ((via === 'email' || via === 'both') && !c.email) return { ok: false, error: 'This contact has no email address. Add one first or send by SMS.' };
    if ((via === 'sms' || via === 'both') && !c.phone) return { ok: false, error: 'This contact has no phone number. Add one first or send by email.' };
    const loc = await getLocation();

    const contactDetails = {
      id: c.id, name: contactName(c) || 'Customer', email: c.email, phoneNo: c.phone, companyName: c.companyName,
      address: { addressLine1: c.address1, city: c.city, state: c.state, countryCode: countryCode(c.country), postalCode: c.postalCode }
    };
    // address must be an object, not a string
    const businessDetails = {
      name: loc.name || 'Our Business', phoneNo: loc.phone, website: loc.website, logoUrl: loc.logoUrl,
      address: { addressLine1: loc.address, city: loc.city, state: loc.state, countryCode: countryCode(loc.country), postalCode: loc.postalCode }
    };

    const body = {
      altId: GHL_LOCATION_ID, altType: 'location',
      name: String(title || ('Invoice for ' + contactDetails.name)).trim(),
      title: 'INVOICE',
      businessDetails: businessDetails,
      currency: CUR,
      items: list.map((it) => {
        const o = { name: it.name, currency: CUR, amount: it.amount, qty: it.qty, type: 'one_time' };
        if (it.description) o.description = it.description;
        return o;
      }),
      discount: { value: 0, type: 'percentage' },
      contactDetails: contactDetails,
      issueDate: todayLocal(),
      dueDate: due_date,
      sentTo: { email: c.email ? [c.email] : [], phoneNo: c.phone ? [c.phone] : [] },
      liveMode: INVOICE_LIVE_MODE
    };
    if (notes) body.termsNotes = '<p>' + String(notes).replace(/</g, '&lt;') + '</p>';

    const created = await ghl('POST', '/invoices/', dropEmpty(body));
    const inv = created.invoice || created;
    const invoiceId = inv._id || inv.id;
    const total = list.reduce((s, it) => s + it.amount * it.qty, 0);
    const result = { ok: true, invoice_id: invoiceId, invoice_number: inv.invoiceNumber || '', total: Math.round(total * 100) / 100,
      currency: CUR, due: due_date, status: 'draft' };

    if (via === 'none') return Object.assign(result, { note: 'Saved as a draft, not sent.' });

    let sender = INVOICE_SENDER_NAME ? await findUser(INVOICE_SENDER_NAME) : null;
    if (!sender) { const users = await getUsers(); sender = users.find((u) => /admin/i.test(u.role)) || users[0]; }
    if (!sender) return Object.assign(result, { ok: false, error: 'Invoice created as draft, but no team member found to send it from.' });

    const action = via === 'both' ? 'sms_and_email' : via;
    try {
      await ghl('POST', '/invoices/' + encodeURIComponent(invoiceId) + '/send',
        { altId: GHL_LOCATION_ID, altType: 'location', userId: sender.id, action: action, liveMode: INVOICE_LIVE_MODE });
      return Object.assign(result, { status: 'sent', sent_via: via });
    } catch (e) {
      return Object.assign(result, { ok: false, error: 'Invoice created as draft but sending failed: ' + (e.message || e) });
    }
  },

  // ---------- internal notifications ----------
  async notify_team_member({ user_name, message, channel, contact_id }) {
    const text = String(message || '').trim();
    if (!text) return { ok: false, error: 'The message is empty.' };
    const u = await findUser(user_name);
    if (!u) return { ok: false, error: 'No team member called "' + user_name + '".', users: (await getUsers()).map((x) => x.name) };
    const ch = norm(channel || 'email');
    if ((ch === 'sms' || ch === 'both') && !u.phone) return { ok: false, error: u.name + ' has no phone number in GHL. Send by email instead?' };

    const url = NOTIFY_WEBHOOK_URL;
    if (!url) return { ok: false, error: 'Internal notifications are not set up for this sub-account yet (no notification webhook URL).' };

    const payload = { user_name: u.name, user_email: u.email, user_phone: u.phone, channel: ch, message: text, sent_at: fmtTime(new Date().toISOString()) };
    if (contact_id) {
      try {
        const c = await getContact(contact_id);
        Object.assign(payload, { contact_id: c.id, contact_name: contactName(c), contact_email: c.email || '', contact_phone: c.phone || '' });
      } catch (e) {}
    }
    const res = await Net.httpRequestAsync(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, postData: JSON.stringify(payload), timeout: 15
    });
    Logger.write('Notify webhook -> ' + res.code);
    if (res.code < 200 || res.code >= 300) return { ok: false, error: 'Notification webhook returned ' + res.code + '.' };
    return { ok: true, notified: u.name, via: ch };
  }
};

// ---------------- Activity feed ----------------
// For each CRM change: a short label (used for failures) and the success sentence.
// Quoted parts ("...") are highlighted in the app.
function fmtMoney(n, cur) {
  const v = Math.round(Number(n) * 100) / 100;
  if (isNaN(v)) return String(n);
  const parts = v.toFixed(v % 1 ? 2 : 0).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (cur || INVOICE_CURRENCY) + ' ' + parts.join('.');
}
const ACTIVITY = {
  add_tag: { label: 'Adding tag', ok: (a, o, who) => 'Tag "' + a.tag + '" added to contact "' + who + '"' },
  remove_tag: { label: 'Removing tag', ok: (a, o, who) => 'Tag "' + a.tag + '" removed from contact "' + who + '"' },
  update_contact_field: { label: 'Updating field', ok: (a, o, who) =>
    'Field "' + o.field + '" set to "' + (Array.isArray(o.new_value) ? o.new_value.join(', ') : o.new_value) + '" for contact "' + who + '"' },
  create_opportunity: { label: 'Creating opportunity', ok: (a, o, who) =>
    'Opportunity "' + o.opportunity + '" created for "' + who + '" in ' + o.pipeline + (o.stage ? ' › ' + o.stage : '') +
    (o.value !== undefined && o.value !== null ? ', value ' + fmtMoney(o.value) : '') },
  move_opportunity: { label: 'Moving opportunity', ok: (a, o, who) =>
    'Opportunity "' + o.opportunity + '" for "' + who + '" moved to stage "' + o.new_stage + '"' },
  update_opportunity: { label: 'Updating opportunity', ok: (a, o, who) => {
    const u = o.updated || {}, bits = [];
    if (u.status) bits.push('marked ' + u.status);
    if (u.monetaryValue !== undefined) bits.push('value set to ' + fmtMoney(u.monetaryValue));
    if (u.name) bits.push('renamed');
    return 'Opportunity "' + o.opportunity + '" for "' + who + '" ' + (bits.join(', ') || 'updated');
  } },
  book_appointment: { label: 'Booking appointment', ok: (a, o, who) =>
    'Appointment booked for "' + who + '" on ' + o.when + (o.calendar ? ' (' + o.calendar + ')' : '') },
  reschedule_appointment: { label: 'Rescheduling appointment', ok: (a, o, who) =>
    'Appointment "' + o.title + '"' + (who ? ' for "' + who + '"' : '') + ' moved from ' + o.from + ' to ' + o.to },
  cancel_appointment: { label: 'Cancelling appointment', ok: (a, o, who) =>
    'Appointment "' + o.cancelled + '"' + (who ? ' for "' + who + '"' : '') + ' on ' + o.was_at + ' cancelled' },
  add_note: { label: 'Adding note', ok: (a, o, who) => 'Note added to contact "' + who + '"' },
  add_task: { label: 'Adding task', ok: (a, o, who) =>
    'Task "' + o.task + '" added for "' + who + '", due ' + o.due + (o.assigned_to && o.assigned_to !== 'unassigned' ? ', assigned to "' + o.assigned_to + '"' : '') },
  send_sms: { label: 'Sending SMS', ok: (a, o, who) => 'SMS sent to "' + who + '"' },
  send_email: { label: 'Sending email', ok: (a, o, who) => 'Email "' + (o.subject || a.subject || '') + '" sent to "' + who + '"' },
  create_invoice: { label: 'Creating invoice', ok: (a, o, who) =>
    'Invoice ' + (o.invoice_number ? '#' + o.invoice_number + ' ' : '') + 'for ' + fmtMoney(o.total, o.currency) + ' ' +
    (o.status === 'sent' ? 'sent to "' + who + '" by ' + (o.sent_via === 'both' ? 'email and SMS' : o.sent_via) : 'saved as a draft for "' + who + '"') },
  notify_team_member: { label: 'Notifying team member', ok: (a, o, who) =>
    'Team member "' + o.notified + '" notified by ' + (o.via === 'both' ? 'email and SMS' : o.via) + (who ? ' about "' + who + '"' : '') }
};

// Builds the activity for a finished CRM action, or null when nothing happened (e.g. a follow-up question)
async function buildActivity(name, args, out) {
  const spec = ACTIVITY[name];
  if (!spec) return null;
  const ok = !!out && out.ok !== false && !out.error;
  if (!ok && out && out.need_choice) return null;
  const contactId = args.contact_id || (out && out.contact_id) || '';
  const who = contactId ? await nameOf(contactId) : '';
  let message;
  try {
    message = ok ? spec.ok(args, out, who) : spec.label + (who ? ' for "' + who + '"' : '') + ' failed: ' + ((out && out.error) || 'unknown error');
  } catch (e) {
    message = spec.label + (ok ? ' done' : ' failed');
  }
  return { action: name, status: ok ? 'success' : 'error', message: message, contact_name: who, contact_id: contactId };
}

// Shows the activity in the app right away and saves it to the history
async function deliverActivity(item, args, out) {
  Logger.write('Activity: ' + item.message);
  try { if (activeCall) activeCall.sendMessage(JSON.stringify({ type: 'activity', item: item })); }
  catch (e) { Logger.write('Activity to app failed: ' + e); }

  if (!SESSION_TOKEN) return;
  try {
    const res = await Net.httpRequestAsync(APP_BASE_URL + '/api/scenario/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SCENARIO_SECRET },
      postData: JSON.stringify(Object.assign({ token: SESSION_TOKEN, details: { args: args, result: out } }, item)),
      timeout: 10
    });
    if (res.code !== 200) Logger.write('Activity save -> ' + res.code + ' ' + String(res.text || '').slice(0, 150));
  } catch (e) { Logger.write('Activity save failed: ' + e); }
}

// Tells the app Nova is busy with something (shown as "Creating invoice…")
function sendWorking(label) {
  try { if (activeCall) activeCall.sendMessage(JSON.stringify({ type: 'working', label: label || '' })); } catch (e) {}
}

// ---------------- Call handling ----------------
VoxEngine.addEventListener(AppEvents.CallAlerting, async (ev) => {
  const call = ev.call;
  activeCall = call;
  let client = null;
  let ended = false;
  const end = (reason) => {
    if (ended) return;
    ended = true;
    Logger.write('Ending: ' + reason);
    try { if (client) client.close(); } catch (e) {}
    VoxEngine.terminate();
  };

  call.addEventListener(CallEvents.Disconnected, () => end('caller hung up'));
  call.addEventListener(CallEvents.Failed, () => end('call failed'));
  setTimeout(() => { try { call.hangup(); } catch (e) {} end('timeout'); }, 15 * 60 * 1000);

  try {
    let customData = ev.customData;
    if (!customData) { try { customData = VoxEngine.customData(); } catch (e) {} }
    await loadSession(customData);

    call.answer();

    client = await Gemini.createLiveAPIClient({
      apiKey: secret('GEMINI_API_KEY'),
      model: GEMINI_MODEL,
      backend: Gemini.Backend.GEMINI_API,
      connectConfig: buildConnectConfig(),
      onWebSocketClose: (event) => {
        Logger.write('Gemini closed: ' + (event ? JSON.stringify(event) : ''));
        end('AI connection closed');
      }
    });

    client.addEventListener(Gemini.LiveAPIEvents.SetupComplete, () => {
      VoxEngine.sendMediaBetween(call, client);
      const greet = 'Introduce yourself as Nova and ask what you can do for them today.';
      if (IS31) client.sendRealtimeInput({ text: greet });
      else client.sendClientContent({ turns: [{ role: 'user', parts: [{ text: greet }] }], turnComplete: true });
    });

    // Text typed in the app arrives as a call message: { type: 'typed', kind, value }
    call.addEventListener(CallEvents.MessageReceived, (e) => {
      let msg = null;
      try { msg = JSON.parse(e.text); } catch (x) { msg = { type: 'typed', kind: 'text', value: e.text }; }
      if (!msg || msg.type !== 'typed' || !String(msg.value || '').trim()) return;
      const value = String(msg.value).trim().slice(0, 300);
      const kind = ['email', 'phone', 'text'].indexOf(msg.kind) !== -1 ? msg.kind : 'text';
      Logger.write('TYPED (' + kind + '): ' + value);
      const text = '[TYPED BY USER] ' + kind + ': ' + value;
      try {
        if (IS31) client.sendRealtimeInput({ text: text });
        else client.sendClientContent({ turns: [{ role: 'user', parts: [{ text: text }] }], turnComplete: true });
        call.sendMessage(JSON.stringify({ type: 'received', value: value }));
      } catch (x) { Logger.write('Typed input failed: ' + x); }
    });

    // Gemini 2.5 native audio sometimes emits a broken tool call ("<ctrl46>") and then goes silent.
    // When a turn ends that way, tell it to make the call again instead of waiting for the user.
    const sendText = (text) => {
      if (IS31) client.sendRealtimeInput({ text: text });
      else client.sendClientContent({ turns: [{ role: 'user', parts: [{ text: text }] }], turnComplete: true });
    };
    let turnBroken = false, turnHadTool = false, retries = 0;

    client.addEventListener(Gemini.LiveAPIEvents.ServerContent, (event) => {
      const payload = (event && event.data && event.data.payload) || {};
      if (payload.inputTranscription && payload.inputTranscription.text) Logger.write('USER: ' + payload.inputTranscription.text);
      const said = payload.outputTranscription && payload.outputTranscription.text;
      if (said) {
        if (/<ctrl\d+>/.test(said)) turnBroken = true;
        else Logger.write('AGENT: ' + said);
      }
      if (payload.interrupted) client.clearMediaBuffer();
      if (payload.turnComplete) {
        if (turnBroken && !turnHadTool && retries < 2) {
          retries++;
          Logger.write('Broken tool call detected, asking Gemini to retry (' + retries + ')');
          try {
            sendText('[SYSTEM] Your last tool call did not go through, nothing was done yet. The user already said yes. ' +
              'Call the correct tool again right now with the same details. Do not ask the user again and do not say it is done until you get the result.');
          } catch (e) { Logger.write('Retry nudge failed: ' + e); }
        }
        turnBroken = false; turnHadTool = false;
      }
    });

    client.addEventListener(Gemini.LiveAPIEvents.ToolCall, async (event) => {
      const calls = (event && event.data && event.data.payload && event.data.payload.functionCalls) || [];
      if (!calls.length) return;
      turnHadTool = true; retries = 0;
      const busy = calls.find((c) => ACTIVITY[c.name]);
      if (busy) sendWorking(ACTIVITY[busy.name].label);

      const done = [];
      const responses = await Promise.all(calls.map(async (fn) => {
        const id = fn.id, name = fn.name, args = fn.args || {};
        Logger.write('Tool ' + name + ' ' + JSON.stringify(args));
        let output;
        if (name === 'request_typed_input') {
          const kind = ['email', 'phone', 'text'].indexOf(args.kind) !== -1 ? args.kind : 'text';
          try {
            call.sendMessage(JSON.stringify({ type: 'ask', kind: kind, label: String(args.label || '').slice(0, 80) }));
            output = { ok: true, note: 'The text box is highlighted on the user\'s screen. Wait for a [TYPED BY USER] message or a spoken answer.' };
          } catch (e) { output = { ok: false, error: 'Could not reach the app: ' + (e.message || e) }; }
        } else if (name === 'hangup_call') {
          setTimeout(() => { try { call.hangup(); } catch (e) {} end('user finished'); }, 5000);
          output = { result: 'Hanging up. Goodbye!' };
        } else if (actions[name]) {
          try { output = await actions[name](args); }
          catch (err) { output = { ok: false, error: String(err.message || err) }; }
          // Give Gemini the exact sentence to say, so it always announces the result
          const item = await buildActivity(name, args, output).catch(() => null);
          if (item) {
            output = Object.assign({}, output, { say: item.status === 'success' ? 'Done. ' + item.message.replace(/"/g, '') + '.' : item.message.replace(/"/g, '') });
            done.push({ item: item, args: args, output: output });
          }
        } else {
          output = { ok: false, error: 'Unknown tool ' + name };
        }
        Logger.write('Result ' + JSON.stringify(output).slice(0, 500));
        return { id, name, response: { output } };
      }));

      client.sendToolResponse({ functionResponses: responses });
      if (busy) sendWorking('');
      // Deliver after answering Gemini, so saving the history never delays the conversation
      done.forEach((d) => deliverActivity(d.item, d.args, d.output).catch((e) => Logger.write('Activity error: ' + e)));
    });

    [Gemini.LiveAPIEvents.ToolCallCancellation, Gemini.LiveAPIEvents.ConnectorInformation].forEach((evName) =>
      client.addEventListener(evName, (e) => Logger.write('Gemini ' + evName + ': ' + JSON.stringify(e && e.data))));
    client.addEventListener(Gemini.LiveAPIEvents.Unknown, (event) => Logger.write('Gemini unknown: ' + JSON.stringify(event && event.data)));
  } catch (err) {
    Logger.write('Agent setup failed: ' + err);
    try { call.answer(); } catch (e0) {}
    try { call.say('Sorry, the assistant is not available right now.', { language: VoiceList.Amazon.en_US_Joanna }); } catch (e2) {}
    setTimeout(() => { try { call.hangup(); } catch (e3) {} end('setup error'); }, 4000);
  }
});

/* ---------------- SETUP NOTES ----------------
1) Voximplant Secrets: GEMINI_API_KEY, APP_BASE_URL (your Vercel URL), SCENARIO_SECRET (same as in Vercel).
   GHL_TOKEN / NOTIFY_WEBHOOK_URL are only needed if the old GHL widget still calls this scenario.

2) GHL Private Integration token scopes (each sub-account's token, entered on the app's Sub-accounts page):
   calendars.readonly, calendars/events.readonly, calendars/events.write,
   invoices.readonly, invoices.write, opportunities.readonly, opportunities.write,
   contacts.readonly, contacts.write, conversations.readonly, conversations/message.readonly, conversations/message.write,
   locations.readonly, locations/customFields.readonly, users.readonly

3) Internal notifications (per sub-account "Team notification webhook URL" in the app):
   In the sub-account create workflow "Inbound Webhook --> Notify Team Member"
   - Trigger: Inbound Webhook. Copy its URL into the sub-account's settings in the app.
   - Run one test notification from Nova so GHL captures a sample payload, then map the contact
     (contact_email / contact_phone) as the trigger's mapping reference.
   - If/Else on {{inboundWebhookRequest.channel}}: email / sms / both
   - Internal Notification (Email): send to custom email {{inboundWebhookRequest.user_email}},
     body uses {{inboundWebhookRequest.message}} and {{inboundWebhookRequest.contact_name}}
   - Internal Notification (SMS): custom number {{inboundWebhookRequest.user_phone}}
   Payload fields: user_name, user_email, user_phone, channel, message, sent_at,
                   contact_id, contact_name, contact_email, contact_phone (contact_* only when about a contact)

4) Invoices use the sub-account's business name, phone, address, website and logo (Settings > Business Profile).
   Payments need a connected payment provider. Switch the sub-account to Test mode in the app while testing.
*/
