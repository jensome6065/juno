# Juno

One card that routes each purchase to the linked card with the best rewards.

At every tap, Juno resolves the merchant (MCC + overrides), scores the wallet against category rates and bonus caps, and routes to the winner — then streams the decision live to the dashboard.

```
juno/
├── apps/
│   ├── web/          # Next.js 16 + Tailwind 4
│   └── api/          # FastAPI (Postgres or SQLite)
├── packages/
│   └── card-rules/   # shared JSON: cards, merchants, MCC, overrides
├── docker-compose.yml
└── .env.example
```

## Prerequisites

- Node 20+
- Python 3.9+
- Docker (with Compose plugin) for Postgres — optional; SQLite is used when `DATABASE_URL` is unset

## Setup

```bash
# env
cp .env.example .env

# postgres (recommended for demos)
docker compose up -d

# api
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# web (new terminal)
cd apps/web
npm install
npm run dev
```

- Web: http://localhost:3000  
- API: http://127.0.0.1:8000/health  
- Docs: http://127.0.0.1:8000/docs  

Mutate routes (`/simulate`, `/infer`, `/demo/*`, `/wallet/pass`) require `X-Demo-Key` (same value as `DEMO_API_KEY` / `NEXT_PUBLIC_DEMO_API_KEY` in `.env`).

## App surfaces

| Route | What it does |
|-------|----------------|
| `/` | Dashboard — Juno Smart Card, savings vs 1% baseline, last-decision pipeline, Activity / Cards / Caps tabs, wallet pass links, live SSE |
| `/terminal` | Tap simulator — pitch chips, 20-merchant catalog, custom merchant + MCC (with category infer), editable amount, finance mode (Reflect 0% APR / 12 mo), score breakdown, replay-same-auth |
| `/lab` | Pitch seed + security proof — reset & seed history, unsigned/bad-signature webhook probes, append-only audit trail |

Keep the dashboard open in another tab while you tap: history and **bonus cap meters** update over SSE when a decision lands.

## Try it

With Postgres (or SQLite), the API, and the web app running, open [http://localhost:3000](http://localhost:3000).

1. Open **Lab** → **Reset & seed pitch** to wipe spend, refill a varied history, and reset caps (audit log is kept).
2. Open **Terminal** and use the **pitch chips** (Dining, Gas, Cap, Override, …) or pick from 20 common places, then **Hold phone to reader**. You’ll get an approval with the winning card, why it won, a score breakdown, and routing latency. An Apple Pay–style NFC chime plays mid-tap.
3. Try **Starbucks at Whole Foods** (Override chip) for a merchant override (MCC looks like grocery, scored as dining). Gas fills Freedom Flex rotating; after that cap is full, groceries usually flip to Amex Gold.
4. Optional: switch to **Custom** for free-text merchant + MCC (`/infer` previews the category), or turn on **Finance mode** to prefer Reflect’s intro 0% APR over rewards.
5. On Terminal, **Replay same auth** reuses the authorization id — the second call is idempotent and should not create a duplicate route.
6. Back on **Lab**, probe unsigned / bad-signature webhooks; rejects land in the audit trail.

Wallet cards in `packages/card-rules/cards.json`: Amex Gold, Freedom Flex, Double Cash, Sapphire Preferred, Freedom Unlimited, Wells Fargo Reflect.

### Cap meters + pitch script (API)

```bash
# Current-period bonus caps (spent / limit / remaining / period)
curl -s http://127.0.0.1:8000/caps | python3 -m json.tool

# Mutate routes need X-Demo-Key (same value as DEMO_API_KEY in .env)
# 7-beat pitch: Starbucks → Shell (burn Flex) → Whole Foods → CVS → Delta → Best Buy → Starbucks at Whole Foods
curl -s -X POST http://127.0.0.1:8000/demo/script \
  -H 'Content-Type: application/json' \
  -H 'X-Demo-Key: juno-demo-local' \
  -d '{"reset": true}' | python3 -m json.tool

# Security audit trail (rejects + routes)
curl -s http://127.0.0.1:8000/security/audit | python3 -m json.tool
```

Expected winners: Amex Gold → Freedom Flex → Amex Gold → Freedom Flex → Amex Gold → Double Cash → Amex Gold (dining override).  
Web client helpers: `api.caps()`, `api.runDemoScript()`, `api.infer()`.

### API map

| Method | Path | Notes |
|--------|------|--------|
| GET | `/health` | Liveness |
| GET | `/cards` | Wallet cards + spend highlights |
| GET | `/transactions` | Routed purchase history |
| GET | `/merchants` | Catalog for Terminal |
| GET | `/caps` | Bonus cap meters |
| GET | `/events` | SSE decision stream |
| POST | `/simulate` | Route a tap (`X-Demo-Key`) |
| POST | `/infer` | Category from name + MCC (`X-Demo-Key`) |
| POST | `/demo/reset` | Wipe spend; keep audit (`X-Demo-Key`) |
| POST | `/demo/script` | Seed 7-beat pitch (`X-Demo-Key`) |
| GET | `/wallet/status` | Pass links |
| POST | `/wallet/pass` | Create WalletWallet pass (`X-Demo-Key`) |
| GET | `/security/status` | Demo trust flags |
| GET | `/security/audit` | Append-only audit |
| POST | `/webhooks/stripe` | Signed Issuing auth requests |

### Optional: Stripe webhook forwarding

```bash
stripe listen \
  --events issuing_authorization.request \
  --forward-to localhost:8000/webhooks/stripe
```

Copy the `whsec_…` value into `.env` as `STRIPE_WEBHOOK_SECRET` and restart the API. For Wallet passes, set `WALLETWALLET_API_KEY` from [walletwallet.dev](https://www.walletwallet.dev), plus optional fixed links:

```bash
WALLETWALLET_APPLE_PASS_URL=https://pass.walletwallet.dev/p/<apple-id>
WALLETWALLET_GOOGLE_PASS_URL=https://pass.walletwallet.dev/p/<google-id>
```

Restart the API so `/wallet/status` seeds both links on the dashboard.

### Tests

```bash
cd apps/api
source .venv/bin/activate
pip install pytest   # if needed
DATABASE_URL=sqlite+pysqlite:///:memory: pytest -q
```

### Troubleshooting

| Symptom | Fix |
|---------|-----|
| Connection refused on port 5432 | Start Docker Desktop, then `docker compose up -d` — or unset `DATABASE_URL` to use local SQLite |
| 401 on simulate / demo | Set matching `DEMO_API_KEY` and `NEXT_PUBLIC_DEMO_API_KEY`, restart API + web |
| Webhook secret shows Off | Run `stripe listen` as above, set `STRIPE_WEBHOOK_SECRET`, restart uvicorn |
| Wallet pass disabled | Set `WALLETWALLET_API_KEY`, restart the API |
| Live badge Offline | Confirm the API is on `:8000` and `NEXT_PUBLIC_API_URL` matches |
