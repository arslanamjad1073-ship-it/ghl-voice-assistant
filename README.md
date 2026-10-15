# Nova · Flowminds CRM assistant

A web app for running GoHighLevel sub-accounts by voice. Your team signs in with their email (Supabase Auth), picks a sub-account, taps the mic and talks to **Nova**. Every change Nova makes shows up live and is saved to the history, for example:

> Tag **"VIP"** added to contact **"John Smith"** · 3:42 PM · Ali · Acme Dental

```
Browser (Next.js on Vercel)
  ├─ /login         Supabase email sign-in (password, magic link, sign-up)
  ├─ /              Home: greeting, Talk to Nova, sub-account picker, recent activity
  ├─ /talk          Call screen: orb, mic / mute, typed input, live "This call" feed
  ├─ /leads         AI lead summary, Q&A, AI follow-up you can edit and send (SMS/Email/FB/IG), follow-up history
  ├─ /subaccounts/[id]/branding  Email branding per sub-account with live preview
  ├─ /history       Every action with day, date and time, filters and search
  └─ /subaccounts   Add / edit / remove GHL sub-accounts (location ID, token, timezone…)
        │
Vercel API routes
  ├─ /api/call/start         creates a call session for the chosen sub-account
  ├─ /api/vox/hash           signs the Voximplant one-time login (password never reaches the browser)
  ├─ /api/activity           history for the UI
  ├─ /api/leads/*            contact search, AI summary, questions about a conversation
  ├─ /api/subaccounts        sub-account CRUD (token verified against GHL on save)
  ├─ /api/scenario/session   ← scenario: loads the sub-account settings for a call
  └─ /api/scenario/activity  ← scenario: saves each completed action
        │
Supabase: auth + tables subaccounts, call_sessions, activities
        │
Voximplant scenario (voximplant/scenario.js): Gemini Live + GHL tools
```

## Prompt command center (Home)
Type what you want, e.g. *"Send an email to peter@example.com thanking him for the call"*. The AI set up on the AI settings page works out the action
(`/api/assist/parse`) and Nova shows a pre-filled form you review and submit. Everything runs through the GHL API and lands in History.

| Prompt | Form |
|---|---|
| send an email / SMS | contact (search or create), **Send as** (GHL team member), subject and body, "Ask AI to write it", email preview with branding, 5-minute resend warning |
| create an invoice | items (name, qty, price), currency, due date, send by email / SMS / both / draft, **Send as**, Live / Test mode |
| add / remove tags | tag chips with the account's existing tags, contact's current tags |
| create / move an opportunity | contact's existing deals, pipeline and stage dropdowns from GHL, status, value |
| book an appointment | calendar dropdown, week view: available (cyan), booked (purple), blocked (striped red), selected |
| add a task / note | assignee dropdown from GHL users, due date and time; AI can write the note |
| summarize a lead | opens the Leads page for that contact |

Quick buttons under the prompt open the same forms empty. Account data for the dropdowns comes from `/api/ghl/meta`.
"Send as" defaults to the team member named in the prompt, else the GHL user with your login email, else an admin.

Adding a sub-account only needs the Location ID and Private Integration token; name, timezone and currency are read from GHL.

## AI settings & usage (account menu › AI settings & usage, `/settings/ai`)
Admins add an API key for Google Gemini, OpenAI, Anthropic Claude, OpenRouter or any OpenAI-compatible endpoint. The key is
tested before it is saved; one key is active at a time and every text feature (prompt parsing, AI write, lead summaries,
follow-ups, questions) uses it. Every request logs input/output tokens to `llm_usage`; cost = tokens × the price per
1M tokens entered for the key (Claude prices are pre-filled; OpenRouter reports the exact cost). The voice agent runs in
Voximplant and is not counted. Without a saved key, `GEMINI_API_KEY` from the environment is used.

**Voice is an optional add-on**, off by default. An admin turns it on per sub-account (Accounts › Edit › Nova voice); the Talk tab
and "Talk instead" button only appear when it is on.

## How a call works
1. The user picks a sub-account and taps the mic. `/api/call/start` creates a `call_sessions` row with a random token.
2. The browser logs in to Voximplant with a **one-time key**. The server computes the hash from `VOX_PASSWORD`, so the password never reaches the browser.
3. The browser calls `crm` and passes the session token in `customData`.
4. The scenario sends the token to `/api/scenario/session` (authenticated with `SCENARIO_SECRET`). It gets back that sub-account's location ID, GHL token, timezone (with the current UTC offset, so daylight saving is handled), currency, invoice settings and notification webhook.
5. After each CRM change, the scenario:
   - sends `{type:"activity"}` to the browser (the live feed)
   - POSTs to `/api/scenario/activity`, which saves it to Supabase for the history

## Setup

### 1. Supabase
The tables are already created in your project (`ytuwpdsmdjwqmflthagg`). To recreate them elsewhere, run `supabase/migrations/0001_init.sql` in the SQL editor.

In the Supabase dashboard:
- **Authentication › URL Configuration**:
  - set **Site URL** to your Vercel URL
  - add `https://YOUR-APP.vercel.app/auth/callback` to **Redirect URLs**
- **Authentication › Providers › Email**: keep it enabled. "Confirm email" is recommended.
- **Optional:** in **Authentication › Policies**, turn on *leaked password protection*. The security advisor flags it.
- **Project Settings › API keys**: copy the **secret / service_role** key into `SUPABASE_SERVICE_ROLE_KEY`.

### 2. Vercel
1. Import this GitHub repo in Vercel. It detects the Next.js framework automatically.
2. Add the environment variables from `.env.example`:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://ytuwpdsmdjwqmflthagg.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | publishable key (in `.env.example`) |
| `SUPABASE_SERVICE_ROLE_KEY` | secret key from Supabase (server only) |
| `ALLOWED_EMAILS` | e.g. `you@company.com,@yourteam.com` (empty = anyone who signs up) |
| `ADMIN_EMAILS` | who may manage sub-accounts (empty = all allowed users) |
| `VOX_USER` / `VOX_APP` / `VOX_NODE` | `webuserr2` / `ghl-dialer.arslanamjad1073` / `NODE_2` |
| `VOX_PASSWORD` | the Voximplant user's password |
| `VOX_CALL_NUMBER` | `crm` |
| `SCENARIO_SECRET` | output of `openssl rand -hex 32` |
| `GEMINI_API_KEY` | optional fallback when no key is saved on the AI settings page |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | from `npx web-push generate-vapid-keys` (push notifications) |
| `VAPID_SUBJECT` | `mailto:` + your email |

3. Deploy, then put the Vercel URL into Supabase (step 1).

### 3. Voximplant
1. Replace the scenario code with `voximplant/scenario.js`. The routing rule `^crm$` stays as is.
2. **Applications › your app › Secrets**: add
   - `APP_BASE_URL`: your Vercel URL, e.g. `https://nova-xyz.vercel.app` (no trailing slash)
   - `SCENARIO_SECRET`: the same value as in Vercel
   - keep `GEMINI_API_KEY`
   - `GHL_TOKEN` and `NOTIFY_WEBHOOK_URL` are only needed if the old GHL widget is still in use. Calls without a session token fall back to the `LEGACY` settings at the top of the scenario.

### 4. First run
1. Open the app, create an account and confirm the email.
2. Go to **Sub-accounts › Add sub-account** and fill in:
   - **Location ID**
   - a **Private Integration token** with the scopes listed on the page

   Name and timezone are filled from GHL when left blank. The token is verified with GHL before it's saved.
3. Go back to **Home**, pick the sub-account and tap **Start talking**.

## Leads page
Pick a sub-account and a contact. The server loads **every** conversation thread for that contact (all pages of messages),
converts times to the sub-account's timezone, and asks Gemini for a sectioned summary. Questions are answered from a fresh copy
of the conversation each time; the follow-up history stays in the browser, so each team member has their own. It works for every
sub-account added on the Sub-accounts page, using that sub-account's token (needs `conversations.readonly`,
`conversations/message.readonly` and `contacts.readonly`).

## Follow-ups
After the summary, Gemini drafts the best next message: a short one for SMS, Facebook and Instagram, and an email (subject and body).
Edit it and send it through GHL (`POST /conversations/messages`).
- Facebook and Instagram are greyed out unless the lead messaged on that channel in the last 24 hours (Meta's reply window).
  SMS needs a phone number and Email needs an email address.
- If anything was sent to the contact in the last 5 minutes (in GHL, or from Nova), you get a warning and must confirm.
- Every send is saved in `followups` (shown as *Follow-up history* on the lead) and in the main History.
- Emails use the sub-account's **email branding** (Sub-accounts › Email branding): logo, font, size, colours, signature, footer.

## Message alerts (in-app + push)
For each sub-account, create a GHL workflow: Trigger **Customer Replied** → Action **Webhook** (POST) to the URL shown under
Sub-accounts › Message alerts (`/api/webhooks/ghl/<key>`). Each inbound message then shows in the bell panel and, for users who turned
push on, as a phone/desktop notification. Tapping it opens the lead. On iPhone, add Nova to the Home Screen first (iOS 16.4+).
- The bell updates instantly: the webhook sends a Supabase Realtime broadcast (topic `nova-notifications`, no message data in it),
  open tabs then fetch the details through the API. A 60-second poll is the fallback.
- Bell › Settings: each user picks which sub-accounts they get alerts for (bell and push), stored in `user_state.muted_subaccounts`.

## Email fonts
Web fonts (Poppins, Inter…) load in Apple Mail, iPhone and most Android apps. Gmail and Outlook cannot load them, so each sub-account
picks a **fallback font** that those apps use (Outlook is forced to it, otherwise it would show Times New Roman). The branding preview
has an *Apple Mail / phones* and a *Gmail / Outlook* view. Emails Nova sends by voice use the same branding and the caller's signature.

## Security notes
- GHL tokens live only in Supabase. They're read with the service-role key on the server and never sent to the browser (the UI shows `••••abcd`).
- All tables have RLS enabled with no policies, so the public anon key can't read them.
- Scenario endpoints require `Authorization: Bearer SCENARIO_SECRET`. Session tokens expire after 1 hour.
- **Rotate the Voximplant password** after testing, then update `VOX_PASSWORD` in Vercel. No code change is needed.

## Local development
```bash
cp .env.example .env.local   # fill in the blanks
npm install
npm run dev                  # http://localhost:3000 (add it to Supabase Redirect URLs)
```
The Voximplant scenario must reach `/api/scenario/*`, so test calls need a public URL: a Vercel preview, or a tunnel such as `ngrok` set as `APP_BASE_URL`.

## Activity messages
The messages are built in the scenario (`ACTIVITY` map). Quoted parts are highlighted in the UI.

| Action | Example |
|---|---|
| add_tag / remove_tag | Tag "VIP" added to contact "John Smith" |
| update_contact_field | Field "City" set to "Lahore" for contact "John Smith" |
| create / move / update_opportunity | Opportunity "Website" for "John Smith" moved to stage "Proposal" |
| book / reschedule / cancel_appointment | Appointment booked for "John Smith" on Tue 14 Oct 2026, 3:00 PM PKT (Demo) |
| add_note / add_task | Task "Call back" added for "John Smith", due Mon 13 Oct…, assigned to "Sara" |
| send_sms / send_email | Email "Quote follow-up" sent to "John Smith" |
| create_invoice | Invoice #1042 for USD 750 sent to "John Smith" by email |
| notify_team_member | Team member "Sara" notified by SMS about "John Smith" |

Failed actions are saved too, shown in red, e.g. *Adding tag for "John Smith" failed: GHL error 401…*.
