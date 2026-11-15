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

## Demo script (fill in as you build)

1. Open the wallet app
2. Show linked cards
3. Simulate a purchase (coffee / groceries / gas)
4. Show which card was chosen and why
