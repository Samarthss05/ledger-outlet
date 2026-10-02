# Ledger Outlet

A TypeScript, React and Vite rebuild of the supplied Ledger Outlet prototype. Supabase provides persistent Postgres records and per-user sign-in. Vercel hosts the web app and a server-side AI function. The OpenRouter API key stays on the server.

## Features

- Email/password sign-up, sign-in, sign-out and password recovery through Supabase Auth.
- Account-owned ledgers with suppliers, catalog items, deliveries, automatic shortage claims, and price history.
- Transactional delivery creation; PostgreSQL row-level security on every exposed table.
- AI questions based on database calculations, order extraction into reviewable supplier drafts, morning briefs and price messages. AI requests require a verified user session and are limited to 30 per account per hour.
- Chat actions for adding suppliers, products and supplier items; editing or activating items; recording quotes, stock counts, usage and deliveries; setting lead times; and updating claim status. Every action opens an editable review form and requires the signed-in user to save it.
- Market & stock desk: comparable products across suppliers, normalized paid prices and quotes, end-of-day stock counts, daily usage/waste, lead-time-based reorder suggestions, and a source-backed buyer brief.
- Optional Singapore Department of Statistics retail reference data from table M213761. It is clearly labelled as consumer retail context and never treated as a wholesale procurement benchmark.
- Reviewable CSV imports for deliveries, usage, stock counts, and supplier quotes. File fingerprints prevent duplicate usage, quote, or delivery records on retry.
- Photo invoice extraction for JPEG, PNG, or WebP images up to 1.5 MB. The image goes to OpenRouter only when the user presses Extract; an editable draft must be confirmed before it becomes a delivery. The image itself is not stored by Ledger Outlet.
- An optional import of the prototype's 59 sample deliveries. Sample data is only added when an authenticated user selects **Import sample ledger**.

## Setup

Requires Node.js 22.12 or newer. Create a Supabase project, apply `supabase/migrations/20260926095543_ledger_outlet_core.sql` with the Supabase migration tool, and copy `.env.example` to `.env` with the project's URL and publishable key. Never put a secret key or OpenRouter key in a `VITE_` variable.

```bash
npm ci --legacy-peer-deps
cp .env.example .env
npm run dev
```

Open http://localhost:5173. Create an account and a ledger, then add suppliers, products, supplier items and deliveries. In **Market & stock**, set pack conversions, record supplier quotes, enter an end-of-day stock count, log daily usage, and set each supplier's delivery lead time. Seven distinct usage dates within 28 days, usage within the past three days, and a stock count within 14 days are required before the app estimates days of cover. Reorder quantities cover lead time, safety days, and one further week; review current stock and incoming orders before placing an order.

To use AI, add `OPENROUTER_API_KEY` to the server environment and restart or redeploy. Chat, order parsing, invoice extraction, and AI prose remain unavailable until the key is supplied. Numeric price and restock calculations work without AI. The buyer brief falls back to a labelled rule-based summary until OpenRouter is configured; with the key, OpenRouter explains only the database-backed facts. `OPENROUTER_MODEL` should support structured output and image input for invoice extraction. `OPENROUTER_AGENT_MODEL` defaults to `openai/gpt-5.4` for the tool-using assistant and proposed ledger edits; it must support tools and structured output. The assistant reads account-scoped data on demand and can combine spend, deliveries, price, stock, claims, and market views. Edits still require review and confirmation.

In **Ask ledger**, try “add Coke as an item,” “record a quote for Coke at S$12.50 per case,” or “record today's stock count.” The assistant proposes fields from the message and current outlet records. Check and fill missing supplier, product, pack size, price, date, and quantities in the review card, then select **Save to ledger**. No catalog or financial record is written when the assistant merely proposes an action. Multi-step imports, external supplier messaging, deletions, and market reference sourcing remain in their dedicated workspace flows.

Supabase's built-in email sender has restrictions and is suitable for testing with organization members. Configure custom SMTP under Supabase Auth before inviting external users; otherwise confirmation and password reset email may not be delivered to them. Add your deployed Vercel URL to Supabase Auth URL configuration (site URL and redirect allowlist) so email confirmation and password recovery return to the app.

## Vercel

The Vercel project uses the Vite build and `api/ai.ts` serverless function. Set these environment variables in Vercel for Production, Preview and Development:

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (browser-safe)
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (server-side validation and RLS queries)
- `OPENROUTER_API_KEY` (server-side only, add when available)
- `OPENROUTER_MODEL`, `OPENROUTER_AGENT_MODEL`, and `APP_URL` (optional)

The repository is connected to Vercel, so pushes to the default branch trigger deployments. Run `npm run build` before pushing. The app is usable without an OpenRouter key; AI calls explain what configuration is missing.

## Data and security

The migration has account ownership and composite foreign keys, so an item, supplier, delivery and line must belong to the same ledger. Row-level security policies restrict all tables to the owner. Public anonymous access is revoked. Database aggregate functions use the caller's permissions; the AI endpoint verifies the Supabase JWT and account ownership before querying them. Delivery creation is one transaction and opens a claim if charged quantity exceeds delivered quantity.

Chat action proposals are structured server-side and checked against current outlet IDs. The browser applies a confirmed action with the signed-in user's Supabase session, so the same row-level security rules apply as in the manual forms. Action confirmations are saved to conversation history. Pending review cards are local to the open chat and can be requested again after a reload.

All amounts come from recorded charged quantities and prices. Supplier messages are reviewable drafts; nothing is sent to a supplier automatically. The seed importer labels its records as sample data using external references and can be retried after interruption.

Price comparisons require the shopkeeper to link equivalent supplier items to one product and confirm how many kg, litres, or each units a pack contains. Existing items with unrecognized units are left unconverted until reviewed. User-entered wholesale references show their source and date; references older than 30 days do not drive an alert. The public SingStat series is a retail average for selected products, sometimes with a different grade or package, and is displayed separately. The app does not claim to know a global wholesale average.

## Code map

- `src/live/LiveApp.tsx`: authenticated web app
- `src/live/data.ts`: Supabase data access
- `src/live/seed.ts`: optional prototype sample import
- `server/liveAi.ts`: verified, database-backed AI logic
- `api/ai.ts`: Vercel function
- `supabase/migrations/`: database schema, RLS, aggregate functions and quota
- `data/demo.json`: sample fixture extracted from the supplied HTML

The attached HTML's descriptive comments were treated as prototype context, not as instructions.
