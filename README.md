# Aangan Studio · Inbound Call Enquiry Engine

MESA Case 03 ("Nikhil: Unanswered Enquiries"). Every inbound phone call to Aangan Studio, an interior design studio in Pune, is answered within seconds, day or night, by a voice agent. The agent qualifies the caller against Nikhil's five criteria and books a consultation in Google Calendar during the call. A designer then gets a handoff note on Telegram, and the founder gets a dashboard of volumes, outcomes and running cost.

**Production:** https://interior-crm-ten.vercel.app

## How a call flows

```
Caller ──► Vaani voice agent (prompt: agent/vaani-agent.md)
             │  mid-call tools ──► POST /api/tools/slots   (free 1-hour slots from Google Calendar)
             │                 ──► POST /api/tools/book    (creates the event, links it to the call)
             ▼ call ends
           POST /api/webhooks/vaani  (event: call_postprocessing)
             ├─ save one row per call (transcript, timings, after-hours flag, voice cost)
             ├─ Gemini Flash judges the 5 criteria (pass / unclear / fail + evidence) and writes the handoff note
             ├─ plain-code rules pick the route (src/lib/route.ts)
             ├─ qualified → HubSpot contact + deal (new callers only)
             ├─ qualified / follow-up / complaint → Telegram message to the designers' group
             └─ dashboard: calls, % answered, % qualified, bookings, cost per call / per qualified lead
```

**Routing rules** (from `context/qualified.md`):
- complaint → `escalate`
- any criterion fails → `closed`
- real project, area or timeline unclear → `follow_up`
- budget or decision-maker unclear → `qualified_flagged`
- everything passes → `qualified`
- missed call, wrong number or no details → `not_enquiry`

The agent never quotes a price (`context/pricing.md`). The commercial minimum is 500 sq ft. There's no fixed minimum lead time; Gemini judges whether the timeline is workable.

## Stack

| Piece | Tech |
|---|---|
| App | Next.js 16 (App Router, Cache Components, `proxy.ts`), TypeScript, Tailwind 4, shadcn/ui (Base UI) |
| Data | Supabase Postgres, schema `interior_crm` on the shared "universal" project. RLS: only team members |
| Auth | Supabase email + password. The first visitor creates the admin account (`/login`) |
| Voice | Vaani Voice agent `aangan-front-desk` (Gemini 3.5 Flash brain, Deepgram STT, Cartesia TTS) |
| AI triage | Gemini Flash (`GEMINI_MODEL`, default `gemini-flash-latest`), JSON schema output, temperature 0 |
| Calendar | Google Calendar, keyless: Vercel OIDC → Workload Identity Federation → service account |
| CRM | HubSpot private static-auth app "Aangan Enquiry Sync" (contacts + deals write) |
| Alerts | Telegram bot `@crmvaanibot` → designers' group |
| Hosting | Vercel (`nanthu1/interior-crm`); pushes to `main` deploy to production |

## Repository map

| Path | What |
|---|---|
| `context/` | Studio files: services, qualification rubric, pricing never-say list. Read at runtime by the triage prompt |
| `agent/vaani-agent.md` | The voice agent's system prompt, extraction fields, disposition, tool + webhook setup |
| `src/lib/engine.ts` | Webhook pipeline: save → triage → route → HubSpot → Telegram |
| `src/lib/integrations/` | `gemini.ts` (5-criteria triage), `vaani.ts` (signature check, types), `google-calendar.ts`, `hubspot.ts`, `telegram.ts` |
| `src/lib/route.ts` | Routing rules, after-hours check (10am–7pm IST is front-desk time) |
| `src/lib/slots.ts` | Consultation slot rules: Mon–Sat, 11:00–17:00 IST starts, 1 hour, ≥3 h notice, max 2 per day offered |
| `src/app/api/` | `webhooks/vaani`, `tools/slots`, `tools/book` |
| `src/app/(app)/` | Dashboard `/`, call log `/calls`, call detail `/calls/[id]` |
| `supabase/migrations/` | Schema (apply in order) |
| `seed/enquiries.json` | The 40 September enquiries with expected routes (eval set) |
| `scripts/` | `eval.mts`, `seed-demo.mts`, `vaani-agent.mjs`, `sync-vercel-env.mjs`, `set-secrets.ps1` |

## Environment

See `.env.example`. Secrets live in `.env.local` (gitignored) and in Vercel env (production, preview, development).

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_APP_URL` | Base URL used in Telegram links |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Service role is server-only (webhooks) |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | |
| `VAANI_API_KEY`, `VAANI_AGENT_ID` | Agent config script |
| `VAANI_WEBHOOK_SECRET` | Shared secret: `?token=` on the webhook URL, `X-Tool-Secret` header on tools |
| `GCP_WIF_AUDIENCE`, `GCP_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_CALENDAR_ID` | Keyless calendar access |
| `HUBSPOT_ACCESS_TOKEN` | Static token of the private app |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Designers' group |
| `VAANI_COST_PER_MIN_INR` | Voice rate for cost tiles (blank = "rate not set") |
| `GEMINI_INPUT_USD_PER_M`, `GEMINI_OUTPUT_USD_PER_M`, `USD_INR` | AI cost estimate |

## Running locally

```bash
npm install
vercel env pull .env.local    # or fill .env.local from .env.example
npm run dev                   # http://localhost:3000
npm run eval                  # 40-transcript triage accuracy (expects 40/40)
npm run seed:demo             # loads the 20 phone transcripts as demo calls (no Telegram/HubSpot)
node --env-file=.env.local scripts/vaani-agent.mjs   # push agent prompt/extraction to Vaani
```

## Operations

- **Change studio rules:** edit `context/*.md` (triage) and `agent/vaani-agent.md` (voice agent). Then run `scripts/vaani-agent.mjs` and `npm run eval`.
- **Add a team member:** create the user in Supabase Auth, then insert a row into `interior_crm.team_members` (`id` = auth user id, `role` ∈ admin/sales/designer).
- **Vaani retries** failed webhooks (0/5/25/125/625 s). The engine is idempotent per `call_id`; a failed triage keeps `processing_error` and is retried.
- **Mismatches:** when the voice agent's live route differs from Gemini's verdict, the call is flagged on the dashboard for review.
- **Facts about real Vaani payloads** (they differ from the docs):
  - `data.call_duration` is in seconds.
  - Exact times are in `data.call_started_at` and `data.call_ended_at`.
  - The caller number is in `from` / `data.phone_number`; web test calls send `"web-user"` instead.
  - Extracted `booking_time` has no zone and means IST.
