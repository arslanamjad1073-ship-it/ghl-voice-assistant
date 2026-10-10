# Nova · Flowminds voice CRM assistant

A web app for running GoHighLevel sub-accounts by voice. Your team signs in with their email (Supabase Auth), picks a sub-account, taps the mic and talks to **Nova**. Every change Nova makes shows up live and is saved to the history, for example:

> Tag **"VIP"** added to contact **"John Smith"** · 3:42 PM · Ali · Acme Dental

```
Browser (Next.js on Vercel)
  ├─ /login         Supabase email sign-in (password, magic link, sign-up)
  ├─ /              Home: greeting, Talk to Nova, sub-account picker, recent activity
  ├─ /talk          Call screen: orb, mic / mute, typed input, live "This call" feed
  ├─ /history       Every action with day, date and time, filters and search
  └─ /subaccounts   Add / edit / remove GHL sub-accounts (location ID, token, timezone…)
        │
Vercel API routes
  ├─ /api/call/start         creates a call session for the chosen sub-account
  ├─ /api/vox/hash           signs the Voximplant one-time login (password never reaches the browser)
  ├─ /api/activity           history for the UI
  ├─ /api/subaccounts        sub-account CRUD (token verified against GHL on save)
  ├─ /api/scenario/session   ← scenario: loads the sub-account settings for a call
  └─ /api/scenario/activity  ← scenario: saves each completed action
        │
Supabase: auth + tables subaccounts, call_sessions, activities
        │
Voximplant scenario (voximplant/scenario.js): Gemini Live + GHL tools
```

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
