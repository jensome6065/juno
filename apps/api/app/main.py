import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import cards, simulate, transactions

app = FastAPI(title="Juno API", version="0.1.0")

origins = [
    o.strip()
    for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(cards.router)
app.include_router(transactions.router)
app.include_router(simulate.router)


@app.get("/health")
def health():
    return {"ok": True, "service": "juno-api"}
