# Single prompt to recreate this application

Copy everything below the line into a fresh Claude Code session. Attach or place these four source files in the project's `context/` folder first: `services.md`, `qualified.md`, `pricing.md`, and the enquiry transcripts PDF (`Aangan_Sep 2026_Enquiries.pdf`).

---

Build and deploy a production-ready **Inbound Call Enquiry Engine** for **Aangan Studio**, an interior design studio in Pune (MESA Case 03, "Nikhil: Unanswered Enquiries"). Take it end to end: make the decisions yourself, commit in small logical commits to a private GitHub repo, deploy to Vercel, and verify every part against real services before saying it's done. Ask me only for logins, API keys, money, or production deploys.

## 1. The problem and the outcome
- Aangan gets about 200 enquiries a month. 48% get no reply within 48 hours, a third arrive outside 10am–7pm, and an enquiry answered within an hour converts 4× better. The average project is ₹8–14 lakh.
- **Scope is inbound phone calls only.** WhatsApp and the web form are out of scope; the README should note how the design could extend to them.
- **Outcome:**
  - every call is answered within seconds, day or night, by a voice agent
  - the agent qualifies the caller against the founder's 5 criteria and books a consultation into Google Calendar during the call
  - a designer gets a complete handoff note on Telegram
  - qualified leads land in HubSpot
  - the founder sees a dashboard of volume, outcomes and running cost
- **Humans only:** quoting prices, making commitments, handling complaints, deciding exceptions.

## 2. Source material (in `context/`, read at runtime)
- `services.md`: what the studio does and doesn't do, plus the service area (Pune city and PCMC).
- `qualified.md`: Nikhil's 5 criteria and how to treat unclear or failed ones.
- `pricing.md`: indicative rates, and **a list of things that must never be said**. No number is ever quoted to a caller.
- The transcripts PDF: 40 enquiries (T01–T20 phone, W01–W10 WhatsApp, F01–F10 web form). Extract them into `seed/enquiries.json` as `{id, channel, header, text, expected[]}` using `pdftotext -enc UTF-8 -layout`, splitting on lines matching `^(T|W|F)\d{2} · `.

**Policy decisions already made:**
- The commercial minimum is 500 sq ft; the maximum is about 3,000 sq ft.
- There's no fixed minimum lead time; the AI judges whether the timeline is workable (design takes 3–4 weeks, then execution).
- Kharadi counts as inside the service area.
- Pricing questions get a deflection, but they don't disqualify the caller.

## 3. Stack (use exactly this)
- **App:** Next.js 16 (App Router, `cacheComponents: true`, `proxy.ts` instead of middleware), TypeScript, Tailwind 4, shadcn/ui on Base UI, zod 4, `server-only`. Read `node_modules/next/dist/docs` before coding. Under Cache Components, every cookie or session read must sit inside `<Suspense>`, and route types (`PageProps<"/x">`, `LayoutProps`) come from `next typegen`.
- **Data:** Supabase Postgres in a dedicated schema `interior_crm`.
  - Add it to the PostgREST exposed schemas through the Management API without removing any existing schemas.
  - Clients: browser and server (`@supabase/ssr`, `db.schema = "interior_crm"`), plus a service-role admin client used only by webhooks and tools.
- **Voice:** Vaani Voice (https://docs.vaanivoice.ai). API base `https://api.vaanivoice.ai/api`, header `X-API-Key`.
- **AI triage:** Gemini Flash over REST (`generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent`, default `gemini-flash-latest`), `responseSchema` JSON output, temperature 0.
- **Calendar:** Google Calendar through a service account, **keyless**: Vercel OIDC → GCP Workload Identity Federation → service-account impersonation (`@vercel/oidc` `getVercelOidcToken()`). Support a base64 key (`GOOGLE_SERVICE_ACCOUNT_JSON`) only as a fallback; Workspace orgs often block key creation.
- **CRM:** a HubSpot private static-auth app created with the HubSpot CLI (`hs project create --project-base app --distribution private --auth static --features`), with scopes `crm.objects.contacts.read/write` and `crm.objects.deals.read/write`, then `hs project upload` and `hs project install-app`. The static token is copied once from the HubSpot UI.
- **Alerts:** a Telegram bot posting to the designers' group. Get the chat id from `getUpdates` after the bot is added and someone messages the group.
- **Hosting:** Vercel. Previews are login-protected, so production hosts the public webhook and tool URLs. Pushes to `main` deploy to production.

## 4. Database (`supabase/migrations/*.sql`, applied in one transaction)
Create schema `interior_crm` with:
- `team_members(id uuid pk → auth.users on delete cascade, full_name, role enum admin|sales|designer default sales, phone, telegram_chat_id, created_at)`
- `leads`: one per phone number.
  - Columns: `id, name, phone unique, email, city, locality, source enum(vaani_call, website, referral, walk_in, instagram, facebook, other), property_type enum, property_size_sqft, rooms, scope, budget_min, budget_max, timeline, stage enum(new, contacted, qualified, site_visit, proposal, negotiation, won, lost), score, ai_summary, lost_reason, assigned_to → team_members, hubspot_contact_id, hubspot_deal_id, next_follow_up_at, created_at, updated_at`.
  - Add an `updated_at` trigger.
- `calls`: **one row per call carries the whole story.**
  - Columns: `id, lead_id → leads, vaani_call_id unique, direction, phone, caller_name, status, started_at, ended_at, after_hours, project_type check(home|office|other), locality, carpet_area_sqft, scope, completion_by, decision_maker, budget_volunteered, criteria jsonb, route enum call_route(qualified, qualified_flagged, follow_up, closed, escalate, not_enquiry), agent_route text, route_mismatch bool, follow_up_question, handoff_note, booking_at, booking_ref, alert_sent_at, hubspot_contact_id, hubspot_deal_id, voice_seconds, ai_input_tokens, ai_output_tokens, ai_cost_inr, voice_cost_inr, end_reason, summary, transcript, recording_url, entities jsonb, dispositions jsonb, raw jsonb, processing_error, is_test bool, created_at, updated_at`.
  - Indexes on `started_at desc` and `route`.
- **RLS:**
  - A `security definer` function `interior_crm.is_team_member()`.
  - Every table gets an `authenticated` policy using it.
  - `team_members` is readable by members, and each member can update their own row.
  - Grant `usage`/`all` to `authenticated` and `service_role`. `anon` gets nothing.

## 5. Triage (`src/lib/integrations/gemini.ts` + `src/lib/route.ts`)
**Gemini's output** (via `responseSchema`):
- `kind` ∈ new_enquiry | complaint | not_enquiry
- `criteria`: for each of `real_project, service_area, timeline, budget, decision_maker`, a `{status: pass|unclear|fail, evidence}`
- extracted fields: `caller_name, project_type, locality, carpet_area_sqft, scope, completion_by, decision_maker, budget_volunteered`
- `follow_up_question`: only when criterion 1–3 is unclear
- `handoff_note`: at most 8 short lines; never prices; FLAG lines for uncertainty, frustration or repeat calls

**The system instruction** is the rules below plus the three context files wrapped in `<file name=…>` tags. Trace `./context/**` into the Vercel bundle with `outputFileTracingIncludes: {"/**": ["./context/**"]}`.

```
You triage phone enquiries for Aangan Studio, an interior design studio in Pune.
Judge each of Nikhil's five criteria from qualified.md as pass, unclear or fail, using only what the caller said.
Status guidance:
- real_project: pass if they want design WITH execution (full home, partial home, a single room redesign, or an office).
  fail if advice/ideas/decor only, furniture sourcing only, Vastu only, structural/architecture work,
  or an out-of-scope space type (restaurant, hotel, retail, gym, hospitality). Commercial spaces under 500 sq ft
  or over ~3,000 sq ft fail. Not knowing exactly what they want is NOT a fail.
- service_area: pass for Pune city or PCMC localities (see services.md). fail for Talegaon, Lonavala, Nashik,
  Mumbai or other cities. unclear if no location was given.
- timeline: pass if the timeline gives room for 3-4 weeks of design plus execution, or if they are flexible.
  fail if they need it finished in a few weeks (e.g. "before Diwali in 3 weeks"). unclear if never discussed.
  There is no fixed minimum number of weeks: judge whether it is workable. Judge relative to the call date in the
  header (assume the current year if none). Design can start right away, so a move-in or completion two or more
  months out is workable.
- budget: pass if not mentioned (do not probe). fail ONLY if the caller volunteered a number clearly below any
  project of that scope (use pricing.md internally to judge). unclear if the number is borderline.
- decision_maker: pass if the caller decides or is clearly authorised. unclear if they are researching for someone
  else, or it was not established. A representative whose principals will attend the consultation is unclear
  (forward with a flag), not a fail.
Existing clients complaining about an ongoing project are kind=complaint (criteria can all be "unclear").
A missed call, dropped call with no details, or wrong number is kind=not_enquiry.
Repeat callers who were not called back: note the frustration in the handoff note.
```

**Routing is plain code, not AI:**
1. complaint → `escalate`
2. not_enquiry → `not_enquiry`
3. any `fail` → `closed`
4. real_project, service_area or timeline `unclear` → `follow_up`
5. budget or decision_maker `unclear` → `qualified_flagged`
6. otherwise → `qualified`

`FORWARDED = [qualified, qualified_flagged]`. After hours means outside 10:00–19:00 IST.

**Usage and cost:**
- Count `promptTokenCount` as input. Count `candidatesTokenCount + thoughtsTokenCount` as output.
- `ai_cost_inr` uses env `GEMINI_INPUT_USD_PER_M` (0.3), `GEMINI_OUTPUT_USD_PER_M` (2.5) and `USD_INR` (88).
- `voice_cost_inr = minutes × VAANI_COST_PER_MIN_INR`. If the rate is blank, show "rate not set".

**Eval:**
- `npm run eval` runs every case in `seed/enquiries.json` through `triageCall` (5 at a time, with retries) and prints `ok/MISS`, each criterion's status, and the total cost.
- Run it with `node --env-file=.env.local --conditions=react-server --import tsx scripts/eval.mts`, as an `.mts` file because it uses top-level await.
- **Expected routes:**
  - T01, T02, T05, T06, T12, T15, T17, T20: qualified or flagged
  - T11, T13, T14: qualified, flagged or follow_up (timeline never asked)
  - T16: qualified, flagged or follow_up
  - T03, T04, T10, T18, T19: closed
  - T07: closed or follow_up
  - T08: not_enquiry
  - T09: escalate
  - W01, W04, W06, F01, F02, F05, F06, F09, F10: qualified or flagged
  - W03, W08, W09: qualified, flagged or follow_up
  - W02, F04: follow_up or not_enquiry
  - F07: not_enquiry or follow_up
  - W05: follow_up
  - W10: follow_up or closed
  - W07, F03, F08: closed
- **Acceptance: 40/40.** The cost is about ₹0.4 per call.

## 6. Vaani webhook (`POST /api/webhooks/vaani`)
**Auth:**
- Accept `?token=<VAANI_WEBHOOK_SECRET>`, or HMAC `X-Vaani-Signature: sha256=<hex>` of `${X-Vaani-Timestamp}.${rawBody}` with a 300 s window.
- Use timing-safe comparisons. Reply 401 otherwise.
- Exempt `/api/webhooks` and `/api/tools` from the login proxy.

**Real payloads differ from the docs. Handle all of these:**
- Top level: `{event, call_id, timestamp, from, to}`. `from` is the caller's number on phone calls and `"web-user"` on web tests.
- `data` contains:
  - `call_duration` in **seconds** (treat values over 36000 as ms)
  - `call_started_at`, `picked_up_at`, `call_ended_at`
  - `summary`, `transcript` (one string of `AGENT:`/`USER:` turns), `recording_url`
  - `entities` (the agent's extraction), `dispositions` (`{route}`)
  - `phone_number` (`"web-user"` on web calls), `end_reason`, `call_type`
- An extracted `booking_time` has **no timezone** and means IST (append `+05:30`).

**Pipeline** (`src/lib/engine.ts`, idempotent per `call_id`; Vaani retries at 0/5/25/125/625 s):
1. Lifecycle events (`call_started`, …) upsert a minimal row (phone, `started_at`, `after_hours`).
2. On `call_postprocessing`, return early if the row already has a route and no `processing_error`.
3. Upsert the row: timings, `after_hours`, `voice_seconds`, `voice_cost_inr`, transcript, `entities`, `dispositions`, `agent_route`, `raw`. Set `booking_at` from the extracted `booking_time` only if the booking tool didn't already set it.
4. Run Gemini triage on: a header with the IST call date and duration, the caller's number, the agent's summary, the captured fields, and the transcript (capped at 40k characters). On error, save `processing_error` and return 500 so Vaani retries.
5. Save the triage. Set `route_mismatch` when the agent's live route differs.
6. Upsert the lead by phone (skip for `not_enquiry`) and link it to the call.
7. If the route is FORWARDED and the lead has no HubSpot id yet: create a HubSpot contact (on a 409, reuse the existing id from the message) and a deal (pipeline `default`, stage `appointmentscheduled`, description = handoff note, associated to the contact with association type 3). Save both ids on the call and the lead.
8. For FORWARDED, `follow_up` or `escalate` routes, send a Telegram HTML message and set `alert_sent_at`. Format:
   - an icon and title (New qualified lead / lead flagged / Follow-up needed · one question / URGENT complaint) plus "after hours" when relevant
   - the caller's name and phone
   - type · locality · sq ft
   - Scope, Timeline, Decides
   - 📅 the consultation time, or "Not booked yet: call to book"
   - "Ask: …" for follow-ups
   - the handoff note
   - a ⚑ line for each criterion that didn't pass, with its evidence
   - a link to `/calls/{id}`
9. Demo or test rows (`is_test`) never notify.

## 7. Mid-call booking tools (Vaani custom tools; header `X-Tool-Secret: <VAANI_WEBHOOK_SECRET>`)
**`POST /api/tools/slots`** (no parameters):
- Returns `{slots:[{start_iso,label}], message}`.
- Slot rules (`src/lib/slots.ts`): Mon–Sat; 1-hour slots starting 11:00–17:00 IST; at least 3 h from now; the next 7 days; minus Google `freeBusy` busy times; offer at most 6, at most 2 per day.
- `label` is a speakable IST string. `message` tells the agent to offer two or three slots.
- If the calendar is unavailable, return a message telling the agent to say a designer will call within the hour.

**`POST /api/tools/book`**:
- Arguments may arrive bare or wrapped in `parameters`, `args` or `arguments`.
- Fields: `start_iso` and `name` (required); `phone`, `consultation_type` (site_visit|studio), `locality`, `scope`.
- Steps:
  1. Validate that the slot is a real offered slot.
  2. Re-check `freeBusy`.
  3. Create the event: "Site visit: {name} ({locality})", description with phone and scope, location = studio or locality, timezone Asia/Kolkata.
  4. Link it to the caller's call from the last 2 h by phone (`booking_at`, `booking_ref`).
  5. Return `{booked, message}` for the agent to read back. Never throw at the agent; always return a speakable message.

**Calendar setup through gcloud** (the user runs `gcloud auth login` once and accepts the Cloud Terms of Service in the console):
1. Create the project.
2. Enable `calendar-json`, `iam`, `sts` and `iamcredentials`.
3. Create the service account `aangan-calendar`.
4. Create the WIF pool `vercel`. Create OIDC provider `vercel-<team>` with issuer `https://oidc.vercel.com/<team>`, allowed audience `https://vercel.com/<team>`, attribute mapping `google.subject=assertion.sub, attribute.project=assertion.project, attribute.owner=assertion.owner`, and condition `assertion.owner=='<team>' && assertion.project=='<project>'`.
5. Grant `roles/iam.workloadIdentityUser` and `roles/iam.serviceAccountTokenCreator` on the service account to `principalSet://…/attribute.project/<project>`.
6. Have the **service account create its own calendar** "Aangan Consultations" (Asia/Kolkata) and share it with the studio owner as `owner`, with notifications on. This avoids Workspace limits on outside sharing.
7. Env: `GCP_WIF_AUDIENCE=//iam.googleapis.com/projects/<num>/locations/global/workloadIdentityPools/vercel/providers/vercel-<team>`, `GCP_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_CALENDAR_ID`.
8. Token chain: Vercel OIDC token → `sts.googleapis.com/v1/token` (token-exchange, `subject_token_type` jwt) → `iamcredentials …:generateAccessToken` (calendar scope). Cache the token until shortly before it expires. Test locally with the `VERCEL_OIDC_TOKEN` from `vercel env pull`.

## 8. Voice agent (`agent/vaani-agent.md` + `scripts/vaani-agent.mjs`)
**The script** creates the agent `aangan-front-desk` (`POST /create-agent`) if `VAANI_AGENT_ID` is unset, saves the id to `.env.local`, then PATCHes:
- **persona:**
  - `identity.system_prompt` = section 1 of the md file
  - greeting "Good day, you've reached Aangan Studio. How can I help you today?"
  - `senses_capabilities.language = "English"` (the name, not a code), `auto_detect: true`
- **analysis:**
  - a prompt-based disposition `route` (string) with tags for the 6 routes
  - data extraction (all nullable): `name, phone_number, project_type [home, office, other], locality, carpet_area_sqft, scope, completion_by, decision_maker, budget_volunteered (only if volunteered), booking_time (ISO, Asia/Kolkata)`
- **experience:** an idle warning at 10 s, hang-up at 25 s, max call 15 min

`GET /api/agent/{id}` (undocumented) returns the full config and is useful for verifying. Agent tools sit in `persona.actions.functions[]` with `is_custom: true`, `function_params` (JSON schema) and `agent_config.params.{api_endpoint, method, headers}`. Creating custom tools, the webhook, publishing and phone numbers need the dashboard login, so give the user a copy-paste checklist file with the secret filled in. Don't print secrets in chat.

**The system prompt, verbatim:**
```
You are the front desk voice of Aangan Studio, an interior design studio in Pune for homes and small offices.
You answer every call, day or night. Be warm, brief and natural. Ask ONE question at a time and wait for the answer.
Speak English by default. If the caller speaks Hindi or Marathi, reply in that language.

### Your job on every call
1. Find out why they are calling.
   - If they are an EXISTING client with a problem on an ongoing project (delays, no reply from their designer, a complaint):
     apologise sincerely, take their name, project location and designer's name, and say
     "I'm getting this to a senior person right now. Someone senior will call you back within 15 minutes."
     Do not argue or make promises about the project. End the call politely.
2. For a new enquiry, collect these naturally, one at a time:
   - Their name
   - Home or office
   - Locality (area of Pune) of the site
   - Size (carpet area in sq ft, or 2BHK / 3BHK)
   - What they want done (rooms / scope) and confirm they want design WITH execution
   - When they need it completed
   - Who decides (are they the owner / authorised to go ahead?)
3. Check fit against the studio's rules below, then do ONE of:
   - Fits: offer a free consultation (a site visit, or at the studio). Call `check_consultation_slots`, offer two or
     three of the returned times, and when they pick one call `book_consultation_appointment` with that slot's `start_iso`, their name,
     the calling number, site visit or studio, the site's locality (the AREA, e.g. Baner, never a person's name) and scope.
     Only pass details the caller actually told you; leave anything unknown empty. Read the confirmed time back to them.
     If booking fails or the calendar is unavailable, say a designer will call within the hour to fix a time.
   - One thing unclear about the project, area or timeline: ask ONE direct question about it.
   - Clearly not a fit: close gracefully (wording below). Never be rude, never lecture.

### Who we serve
- Residential: apartments, independent houses, villas. Full home, a full floor, 2+ rooms, or a single room as a complete redesign WITH execution. Rented flats are fine if no structural changes.
- Commercial: offices, clinics, studios from about 500 to 3,000 sq ft.
- Area: Pune city and PCMC (Kothrud, Baner, Aundh, Wakad, Koregaon Park, Kalyani Nagar, Viman Nagar, Hadapsar, Magarpatta, NIBM, Kondhwa, Undri, Shivane, Warje, Erandwane, Deccan, Kharadi, Pimpri, Chinchwad, Pimple Saudagar, Pimple Nilakh, Ravet, Hinjewadi and nearby).
- Process: design takes 3 to 4 weeks from the first consultation, execution 8 to 16 weeks depending on size.

### We do NOT take
- Advice only, colours or furniture arrangement only, "come and give ideas", or "I'll do the execution myself"
- Architecture or structural work (moving walls, permits), Vastu-only consultation, furniture sourcing without a design project
- Restaurants, hotels, retail stores, gyms
- Sites outside Pune and PCMC (Talegaon, Lonavala, Nashik, Mumbai, other cities)
- Commercial spaces under about 500 sq ft
- Projects that must be finished in a few weeks (design alone takes 3 to 4 weeks). Offer a later start instead.

### Budget
Never ask about budget. If the caller volunteers a number that is clearly far too low for what they describe
(for example 1 to 1.5 lakh for a kitchen plus a bedroom with execution), say kindly that it would be well below what a
project of that scope costs with the studio, and suggest local contractors who work at that price point.

### Pricing: NEVER give a number
Never say any price, range, per-sq-ft rate, "it'll cost around", "our rates start at", or "for a 2BHK it's typically".
If asked about price, even repeatedly, say exactly:
"Pricing depends on the site, the materials you choose, and the scope. Your designer will walk you through it in detail at the consultation. I can book that for you right now if you'd like."
If they push again: "I really can't give a number that would mean anything without seeing the site. The consultation is free and there's no obligation."

### Graceful close (not a fit)
"This sounds like it may not be the right fit for us right now, but please do reach out if your timeline or scope changes. Thank you for calling Aangan Studio."
For out-of-area or out-of-scope requests, briefly say why (no vendor network outside Pune / not a space type we design).

### Never
- Promise dates, discounts, designers or anything the studio has not confirmed: "your designer will confirm that at the consultation"
- Share other clients' details
- Pretend to be human if sincerely asked; say you are Aangan's virtual assistant and a designer will follow up
```

**Tools in the dashboard:**
- `check_consultation_slots`: POST `{APP}/api/tools/slots`, header `X-Tool-Secret`, no parameters.
- `book_consultation_appointment`: POST `{APP}/api/tools/book`, same header, parameters as in §7, only `start_iso` and `name` required.

**Webhook:** `{APP}/api/webhooks/vaani?token=<secret>` with event `call_postprocessing` and "send all call details" on.

## 9. Web app (signed-in team only)
- **`/login`:** email + password with `useActionState` server actions. While no team member exists, the form becomes "Create admin account": it creates the auth user (email confirmed) and an admin `team_members` row, then signs in. Signed-in users who aren't on the team see "not on the team yet".
- **`proxy.ts`:** refreshes the Supabase session and redirects signed-out users to `/login`. It skips static files, `/api/webhooks` and `/api/tools`. Real authorization is `getCurrentMember()` plus RLS.
- **Layout:** a header with "Aangan · Enquiries", Dashboard and Calls links, and the user's name with sign-out inside `<Suspense>`.
- **Dashboard `/`:**
  - Toggles: Live calls vs. "September demo" (`is_test`), and 7/30/90 days.
  - Stat tiles: Calls (with % and count after hours); Answered by the agent (% with a voice duration over 0); Qualified (forwarded ÷ enquiries, excluding not_enquiry and escalate); Consultations booked (with median minutes from call end to handoff).
  - "Where calls went": a bar per route, each linking to a filtered call list. Show a mismatch warning when needed.
  - "What it costs": voice minutes and cost, AI cost, total, per call, per qualified lead.
  - The latest 8 calls.
- **`/calls`:** a table of when (with a moon icon for after hours), caller, project, route badge, booked, and length. Filter by route; the whole row is clickable.
- **`/calls/[id]`:**
  - Header: route badge, after-hours and demo tags, processing-error and mismatch banners.
  - Handoff note plus "Ask next".
  - The 5 criteria with status colours and evidence.
  - Recording player and transcript.
  - Sidebar: captured fields, AI and voice cost, HubSpot deal id.
- Use INR formatting (`en-IN`) and IST everywhere. It must work at phone width. Route badges have colours that work in both light and dark mode.

## 10. Scripts and ops
- `scripts/seed-demo.mts`: runs the 20 phone transcripts through the real pipeline as `is_test` rows (`demo-T01…`), using the real call times and durations. No notifications.
- `scripts/sync-vercel-env.mjs [--prod] [KEYS…]`: pushes `.env.local` values to Vercel via stdin. `NEXT_PUBLIC_*` values are stored as config (`--no-sensitive`); skip `VERCEL_OIDC_TOKEN`.
- `scripts/set-secrets.ps1`: asks for keys with masked input and stores each as a Windows user env var plus in `.env.local`, written UTF-8 **without a BOM**.
- `README.md`: architecture, env table, run, eval and seed commands, ops notes, and the Vaani payload facts.
- `.env.example` lists every variable: `NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY, GEMINI_MODEL, HUBSPOT_ACCESS_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, VAANI_API_KEY, VAANI_AGENT_ID, VAANI_WEBHOOK_SECRET, GCP_WIF_AUDIENCE, GCP_SERVICE_ACCOUNT_EMAIL, GOOGLE_CALENDAR_ID, GOOGLE_SERVICE_ACCOUNT_JSON (optional), VAANI_COST_PER_MIN_INR, GEMINI_INPUT_USD_PER_M, GEMINI_OUTPUT_USD_PER_M, USD_INR`.

## 11. Verify before calling it done
1. `tsc --noEmit`, `eslint` and `next build` are all clean.
2. `npm run eval` gives 40/40, and `npm run seed:demo` loads 20 demo calls.
3. Locally: `/login` returns 200; `/` redirects to `/login` when signed out; signed-in pages render real data (use a throwaway team member and delete it afterwards); unsigned webhook and tool calls get 401.
4. Production: run a scripted end-to-end call, then delete everything it created:
   1. `call_started`
   2. `/api/tools/slots`, which must return real free times
   3. `/api/tools/book`, which must create an event in Google Calendar
   4. `call_postprocessing` with a qualified transcript
   5. Expect: a `qualified` row with `booking_at`, HubSpot contact and deal ids, `alert_sent_at` set, the Telegram message received, and `ai_cost` recorded.
5. A real Vaani web test call reaches the webhook, gets triaged, and its booking shows up in the calendar.
6. Report what was built, the decisions made, how it was verified (with real outputs), the links, and anything left for the user (phone number purchase, publishing).
