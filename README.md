# Juno

One card that routes each purchase to the linked card with the best rewards.

```
juno/
├── apps/
│   ├── web/          # Next.js + Tailwind
│   └── api/          # FastAPI
├── packages/
│   └── card-rules/   # shared JSON reward library
├── docker-compose.yml
└── .env.example
```

## Prerequisites

- Node 20+
- Python 3.9+
- Docker (with Compose plugin)

## Setup

```bash
# env
cp .env.example .env

# postgres
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

## Try it

With Postgres, the API, and the web app running (see Setup above), open [http://localhost:3000](http://localhost:3000).

The dashboard lists the linked rewards cards behind Juno and any routed purchases. From there, open **Terminal** to simulate a merchant tap: use the **pitch chips** (Dining, Gas / rotating, Cap burn, Override, …) or pick from 20 common places, then **Hold phone to reader**. You’ll get an approval with the winning card, why it won, a score breakdown against the other cards, and routing latency.

Keep the dashboard open in another tab while you tap — history and **bonus cap meters** update live over SSE when a decision lands. Use **Reset & seed pitch** on the dashboard to wipe transactions, refill a varied history, and reset caps. On the dashboard, the **Security** section shows whether the Stripe webhook secret is loaded and other controls; **Probe webhook rejects** sends unsigned and bad-signature requests to `/webhooks/stripe` so you can confirm they fail. Back on the terminal, **Replay same auth** reuses the authorization id — the second call is idempotent and should not create a duplicate route.

Different merchants exercise different rules. Try **Starbucks at Whole Foods** (Override chip) to see a merchant override (MCC looks like grocery, scored as dining). Gas fills Freedom Flex rotating; after that cap is full, groceries usually flip to Amex Gold.

### Cap meters + pitch script (API)

For UX wiring and judge-proof demos (no dropdown fumbling):

```bash
# Current-period bonus caps (spent / limit / remaining / period)
curl -s http://127.0.0.1:8000/caps | python3 -m json.tool

# 7-beat pitch: Starbucks → Shell (burn Flex) → Whole Foods → CVS → Delta → Best Buy → Starbucks at Whole Foods
curl -s -X POST http://127.0.0.1:8000/demo/script \
  -H 'Content-Type: application/json' \
  -d '{"reset": true}' | python3 -m json.tool
```

Expected winners: Amex Gold → Freedom Flex → Amex Gold → Freedom Flex → Amex Gold → Double Cash → Amex Gold (dining override).  
Web client helpers: `api.caps()` and `api.runDemoScript()`.

### Optional: Stripe webhook forwarding

```bash
stripe listen \
  --events issuing_authorization.request \
  --forward-to localhost:8000/webhooks/stripe
```

Copy the `whsec_…` value into `.env` as `STRIPE_WEBHOOK_SECRET` and restart the API. For Apple Wallet presence, set `WALLETWALLET_API_KEY` from [walletwallet.dev](https://www.walletwallet.dev) the same way.

### Troubleshooting

| Symptom | Fix |
|---------|-----|
| Connection refused on port 5432 | Start Docker Desktop, then `docker compose up -d db` |
| Webhook secret shows Off | Run `stripe listen` as above, set `STRIPE_WEBHOOK_SECRET`, restart uvicorn |
| Wallet pass disabled | Set `WALLETWALLET_API_KEY`, restart the API |
| Live badge Offline | Confirm the API is on `:8000` and `NEXT_PUBLIC_API_URL` matches |
