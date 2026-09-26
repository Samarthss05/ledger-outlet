# Ledger Outlet

A TypeScript, React and Vite rebuild of the supplied Ledger Outlet prototype. Supabase provides persistent Postgres records and per-user sign-in. Vercel hosts the web app and a server-side AI function. The OpenRouter API key stays on the server.

## Features

- Email/password sign-up, sign-in, sign-out and password recovery through Supabase Auth.
- Account-owned ledgers with suppliers, catalog items, deliveries, automatic shortage claims, and price history.
- Transactional delivery creation; PostgreSQL row-level security on every exposed table.
- AI questions based on database calculations, order extraction into reviewable supplier drafts, morning briefs and price messages. AI requests require a verified user session and are limited to 30 per account per hour.
- An optional import of the prototype's 59 sample deliveries. Sample data is only added when an authenticated user selects **Import sample ledger**.

## Setup

Requires Node.js 22.12 or newer. Create a Supabase project, apply `supabase/migrations/20260926095543_ledger_outlet_core.sql` with the Supabase migration tool, and copy `.env.example` to `.env` with the project's URL and publishable key. Never put a secret key or OpenRouter key in a `VITE_` variable.

```bash
npm ci --legacy-peer-deps
cp .env.example .env
npm run dev
```

Open http://localhost:5173. Create an account and a ledger, then add suppliers, items and deliveries. To use AI, add `OPENROUTER_API_KEY` to the server environment and restart. AI remains unavailable until the key is supplied. The default model and response format use OpenRouter structured JSON output.

Supabase's built-in email sender has restrictions and is suitable for testing with organization members. Configure custom SMTP under Supabase Auth before inviting external users; otherwise confirmation and password reset email may not be delivered to them. Add your deployed Vercel URL to Supabase Auth URL configuration (site URL and redirect allowlist) so email confirmation and password recovery return to the app.

## Vercel

The Vercel project uses the Vite build and `api/ai.ts` serverless function. Set these environment variables in Vercel for Production, Preview and Development:

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (browser-safe)
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (server-side validation and RLS queries)
- `OPENROUTER_API_KEY` (server-side only, add when available)
- `OPENROUTER_MODEL` and `APP_URL` (optional)

The repository is connected to Vercel, so pushes to the default branch trigger deployments. Run `npm run build` before pushing. The app is usable without an OpenRouter key; AI calls explain what configuration is missing.

## Data and security

The migration has account ownership and composite foreign keys, so an item, supplier, delivery and line must belong to the same ledger. Row-level security policies restrict all tables to the owner. Public anonymous access is revoked. Database aggregate functions use the caller's permissions; the AI endpoint verifies the Supabase JWT and account ownership before querying them. Delivery creation is one transaction and opens a claim if charged quantity exceeds delivered quantity.

All amounts come from recorded charged quantities and prices. Supplier messages are reviewable drafts; nothing is sent to a supplier automatically. The seed importer labels its records as sample data using external references and can be retried after interruption.

## Code map

- `src/live/LiveApp.tsx`: authenticated web app
- `src/live/data.ts`: Supabase data access
- `src/live/seed.ts`: optional prototype sample import
- `server/liveAi.ts`: verified, database-backed AI logic
- `api/ai.ts`: Vercel function
- `supabase/migrations/`: database schema, RLS, aggregate functions and quota
- `data/demo.json`: sample fixture extracted from the supplied HTML

The attached HTML's descriptive comments were treated as prototype context, not as instructions.
