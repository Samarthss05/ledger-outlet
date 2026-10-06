# ReStock by Ledger

A TypeScript, React and Vite rebuild of the supplied Ledger Outlet prototype, branded as ReStock by Ledger using the supplied visual kit. Supabase provides persistent Postgres records and per-user sign-in. Vercel hosts the web app and a server-side AI function. The OpenRouter API key stays on the server.

The original vector logos and app icon from the ReStock brand package are in `public/brand/`. The interface uses the kit's Ink, Ledger Green, Light Green, Cream, Night, and Mint palette. The repository and deployment URL retain their existing technical names.

## Features

- Email/password sign-up, sign-in, sign-out and password recovery through Supabase Auth.
- Account-owned ledgers with suppliers, catalog items, deliveries, automatic shortage claims, and price history.
- Transactional delivery creation; PostgreSQL row-level security on every exposed table.
- A multiagent purchasing assistant: a coordinator delegates account-scoped work to catalog, pricing, stock, supplier operations, and finance specialists. A separate reviewer checks the combined answer against source facts. AI requests require a verified user session and are limited to 30 per account per hour.
- Chat actions for adding suppliers, products and supplier items; editing or activating items; recording quotes, stock counts, usage, deliveries, and sourced wholesale benchmarks; setting lead times; and updating claim status. A request may prepare up to five changes. Each opens its own editable review form and requires the signed-in user to save it.
- Reviewable outlet memory: say “remember that…” to save a shop-specific fact for future conversations. Saved facts can be removed from the conversation sidebar. Memory is account-scoped by RLS.
- Market & stock desk: comparable products across suppliers, normalized paid prices and quotes, end-of-day stock counts, daily usage/waste, lead-time-based reorder suggestions, and a source-backed buyer brief.
- Optional Singapore Department of Statistics retail reference data from table M213761. It is clearly labelled as consumer retail context and never treated as a wholesale procurement benchmark.
- Reviewable CSV imports for deliveries, usage, stock counts, and supplier quotes. File fingerprints prevent duplicate usage, quote, or delivery records on retry.
- Photo invoice extraction for JPEG, PNG, or WebP images up to 1.5 MB. The image goes to OpenRouter only when the user presses Extract; an editable draft must be confirmed before it becomes a delivery. The image itself is not stored by ReStock.
- An optional import of the prototype's 59 sample deliveries. Sample data is only added when an authenticated user selects **Import sample ledger**.
- WhatsApp order desk: owner-number verification, supplier WhatsApp contacts and delivery schedules, a read-only message preview, account-specific item matching, supplier splits, owner confirmation, supplier order tracking, and classification of supplier replies. The Meta webhook and sender stay disabled until the Cloud API credentials and approved templates are configured.

## WhatsApp ordering

Orders originate on WhatsApp. The web **Orders** page is for one-time setup, testing a message without sending it, and checking what happened. It does not place supplier orders.

1. Add each supplier and its active supplier items in the catalog. Each item needs a buying pack unit and can have spoken name and pack-unit aliases. On **Orders**, enter the owner's international WhatsApp number, outlet address, each supplier's number, delivery days, and Singapore-time order cut-off.
2. Connect the shared Ledger number to [Meta's WhatsApp Cloud API](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api) and subscribe the app's **messages** webhook to `https://ledger-outlet.vercel.app/api/whatsapp-webhook`. The GET verification uses `WHATSAPP_VERIFY_TOKEN`; POST requests must pass the raw-body `X-Hub-Signature-256` check using `WHATSAPP_APP_SECRET`.
3. Set the server-only environment variables below in Vercel. The phone number ID, WABA token, and app secret come from the Meta business app. Add a Supabase secret/service-role key for the signed webhook worker; do not put any of these in `VITE_` variables or the repository. Redeploy after setting them.
4. Create and obtain approval for two Meta utility templates. `WHATSAPP_ORDER_TEMPLATE_NAME` must have four body variables, in this order: **order reference**, **shop name and address**, **item lines**, **delivery date and window**. Suggested body: `Order {{1}} from {{2}}. Items: {{3}}. Delivery: {{4}}. Please reply with confirmation or changes, mentioning {{1}}.` `WHATSAPP_OWNER_ALERT_TEMPLATE_NAME` must have three: **order reference**, **supplier**, **reply summary**. Suggested body: `Update for {{1}} from {{2}}: {{3}}. Open ReStock for details.` Meta requires approved templates for business-initiated messages outside a recipient's 24-hour service window; the supplier order always uses a template. See [Meta's business messaging policy](https://whatsappbusiness.com/policy/?faq=5).
5. Once the line is connected, the owner sends `LINK <code>` from the number shown in the Orders setup panel. Linking proves control of the phone. The code expires in 24 hours and can be regenerated.

The ordering agent reads only this outlet's active item list. It flags unmatched names, ambiguous packs, missing or mismatched units, missing supplier numbers, non-delivery days, insufficient lead time, missed cut-offs, and uncertain delivery dates. It never dispatches a partial order. The owner receives a grouped summary and replies `OK <six-character code>` (or `CANCEL <code>`). A bare `OK` is accepted only when exactly one unexpired order awaits confirmation. On confirmation, Ledger rechecks the catalog, supplier recipient, delivery schedule, lead time, and cut-off before dispatch. Supplier orders use unique `LO-...` references. A supplier reply is matched by that reference, WhatsApp reply context, or a single unambiguous recent order; uncertain replies are retained for operator review and do not change an order's status.

Webhook events are written to an idempotent inbox before processing, then processed after the acknowledgment. If an invocation ends early, queued events remain in Postgres. For a production pilot, configure a trusted scheduler to POST to `/api/whatsapp-drain` with `Authorization: Bearer <WHATSAPP_WORKER_SECRET>`; it processes up to five queued events per call. Reconcile any supplier order stuck at **Sending status unknown** before retrying, because Meta may have accepted the message even if the API request timed out. The worker never retries such supplier sends automatically. If an owner alert template fails, the supplier reply remains visible in **Orders** with an alert-failed label. A supplier's “delivered” message is shown as **Supplier reports delivered**. The owner can reply `RECEIVED LO-<reference>` to mark that supplier order received. This does not create an accounting delivery or invent invoice amounts; actual quantities and prices are recorded separately.

Dedicated numbers are represented by a per-outlet Meta phone number ID in the setup data. Provisioning, billing for the proposed +S$15/month option, and token routing across multiple WABAs still need their own integration. Reorder nudges and nearby demand aggregation are future intelligence work; this release captures the order events needed for them.

## Setup

Requires Node.js 22.12 or newer. Create a Supabase project, apply all files in `supabase/migrations/` in timestamp order with the Supabase migration tool, and copy `.env.example` to `.env` with the project's URL and publishable key. Never put a secret key or OpenRouter key in a `VITE_` variable.

```bash
npm ci --legacy-peer-deps
cp .env.example .env
npm run dev
```

Open http://localhost:5173. Create an account and a ledger, then add suppliers, products, supplier items and deliveries. In **Market & stock**, set pack conversions, record supplier quotes, enter an end-of-day stock count, log daily usage, and set each supplier's delivery lead time. Seven distinct usage dates within 28 days, usage within the past three days, and a stock count within 14 days are required before the app estimates days of cover. Reorder quantities cover lead time, safety days, and one further week; review current stock and incoming orders before placing an order.

To use AI, add `OPENROUTER_API_KEY` to the server environment and restart or redeploy. Chat, order parsing, invoice extraction, and AI prose remain unavailable until the key is supplied. Numeric price and restock calculations work without AI. The buyer brief falls back to a labelled rule-based summary until OpenRouter is configured; with the key, OpenRouter explains only the database-backed facts. `OPENROUTER_MODEL` should support structured output and image input for invoice extraction. `OPENROUTER_AGENT_MODEL` defaults to `openai/gpt-5.4` for the coordinator, specialists, reviewer, and proposed ledger edits; it must support structured output. The agent team reads account-scoped data on demand and can combine spend, deliveries, prices, stock, claims, catalog, and market views. Edits still require review and confirmation.

In **Ask ledger**, try “compare Coke prices and stock,” “add Coke as an item and record a stock count,” or “record a sourced wholesale benchmark.” The team researches the relevant records, explains its specialists' findings, and proposes any requested changes. Check and fill missing supplier, product, pack size, price, source, date, and quantities in each review card, then select **Save to ledger**. No catalog or financial record is written when the agents merely propose an action. CSV imports and deletions remain in their dedicated workspace flows. Supplier order messaging happens through the WhatsApp flow above.

Supabase's built-in email sender has restrictions and is suitable for testing with organization members. Configure custom SMTP under Supabase Auth before inviting external users; otherwise confirmation and password reset email may not be delivered to them. Add your deployed Vercel URL to Supabase Auth URL configuration (site URL and redirect allowlist) so email confirmation and password recovery return to the app.

## Vercel

The Vercel project uses the Vite build and `api/ai.ts` serverless function. Set these environment variables in Vercel for Production, Preview and Development:

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (browser-safe)
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (server-side validation and RLS queries)
- `OPENROUTER_API_KEY` (server-side only, add when available)
- `OPENROUTER_MODEL`, `OPENROUTER_AGENT_MODEL`, and `APP_URL` (optional)
- `SUPABASE_SECRET_KEY` (server-only, required for Meta webhook database writes; a legacy `SUPABASE_SERVICE_ROLE_KEY` also works)
- `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_SHARED_PHONE_NUMBER_ID`, `WHATSAPP_GRAPH_VERSION`
- `WHATSAPP_ORDER_TEMPLATE_NAME`, `WHATSAPP_OWNER_ALERT_TEMPLATE_NAME` and optional language codes
- `WHATSAPP_WORKER_SECRET` for a trusted queue-drain scheduler

The repository is connected to Vercel, so pushes to the default branch trigger deployments. Run `npm run build` before pushing. The app is usable without an OpenRouter key; AI calls explain what configuration is missing.

## Data and security

The migration has account ownership and composite foreign keys, so an item, supplier, delivery and line must belong to the same ledger. Row-level security policies restrict all tables to the owner. Public anonymous access is revoked. Database aggregate functions use the caller's permissions; the AI endpoint verifies the Supabase JWT and account ownership before querying them. Delivery creation is one transaction and opens a claim if charged quantity exceeds delivered quantity.

The coordinator chooses relevant ledger views. Domain agents analyze those account-scoped records in parallel; a reviewer checks the combined answer. Agent summaries and cited facts are saved with the conversation. User-approved outlet memories are retrieved as context for later requests; this is persistent memory, not model fine-tuning. Chat action proposals are structured server-side, checked against current outlet IDs, and reviewed by a separate action reviewer. The browser applies each confirmed action with the signed-in user's Supabase session, so the same row-level security rules apply as in the manual forms. Action confirmations are saved to conversation history. Pending review cards are local to the open chat and can be requested again after a reload.

All amounts come from recorded charged quantities and prices. Supplier orders are sent only after the owner confirms the WhatsApp summary; AI parsing alone cannot dispatch them. The seed importer labels its records as sample data using external references and can be retried after interruption.

Price comparisons require the shopkeeper to link equivalent supplier items to one product and confirm how many kg, litres, or each units a pack contains. Existing items with unrecognized units are left unconverted until reviewed. User-entered wholesale references show their source and date; references older than 30 days do not drive an alert. The public SingStat series is a retail average for selected products, sometimes with a different grade or package, and is displayed separately. The app does not claim to know a global wholesale average.

## Code map

- `src/live/LiveApp.tsx`: authenticated web app
- `src/live/data.ts`: Supabase data access
- `src/live/seed.ts`: optional prototype sample import
- `server/agentTeam.ts`: coordinator, specialist agents, and independent answer reviewer
- `server/ledgerAgent.ts`: account-scoped ledger reads used by the specialists
- `server/liveAi.ts`: verified AI endpoint and action preparation
- `api/ai.ts`: Vercel function
- `server/whatsappOrder.ts`: WhatsApp message extraction and deterministic order checks
- `server/whatsappWebhook.ts`: owner confirmation, supplier dispatch, and supplier reply routing
- `api/whatsapp-webhook.ts`: signed Meta webhook
- `src/live/WhatsAppOrdersPanel.tsx`: mobile-ready onboarding, preview, and activity page
- `supabase/migrations/`: database schema, RLS, aggregate functions and quota
- `data/demo.json`: sample fixture extracted from the supplied HTML

The attached HTML's descriptive comments were treated as prototype context, not as instructions.
