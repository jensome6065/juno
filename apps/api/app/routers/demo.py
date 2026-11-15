"""Demo helpers — wipe state between pitches."""

from __future__ import annotations

from pydantic import BaseModel
from fastapi import APIRouter

from app.events import publish
from app.store import reset
from app.services import walletwallet

router = APIRouter(prefix="/demo", tags=["demo"])


class ResetResponse(BaseModel):
    ok: bool = True
    wallet_updated: bool = False


@router.post("/reset", response_model=ResetResponse)
def reset_demo() -> ResetResponse:
    """Clear transactions, cap ledger, and pass state for a clean demo."""
    reset()
    wallet_updated = False
    try:
        if walletwallet.configured() and walletwallet.update_pass():
            wallet_updated = True
    except Exception:  # noqa: BLE001 — reset still succeeds if WalletWallet is down
        wallet_updated = False

    publish("demo.reset", {})
    return ResetResponse(ok=True, wallet_updated=wallet_updated)
