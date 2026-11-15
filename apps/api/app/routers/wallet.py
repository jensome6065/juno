from fastapi import APIRouter, HTTPException

from app.schemas import WalletPassOut, WalletStatusOut
from app.services import walletwallet
from app.store import get_pass_state

router = APIRouter(prefix="/wallet", tags=["wallet"])


@router.get("/status", response_model=WalletStatusOut)
def wallet_status() -> WalletStatusOut:
    state = get_pass_state()
    return WalletStatusOut(
        configured=walletwallet.configured(),
        serial_number=state.get("serial_number"),
        share_url=state.get("share_url"),
        google_save_url=state.get("google_save_url"),
    )


@router.post("/pass", response_model=WalletPassOut)
def create_wallet_pass() -> WalletPassOut:
    if not walletwallet.configured():
        raise HTTPException(
            status_code=503,
            detail="Set WALLETWALLET_API_KEY in .env (from https://www.walletwallet.dev)",
        )
    try:
        created = walletwallet.create_pass()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return WalletPassOut(
        serial_number=created["serial_number"],
        share_url=created.get("share_url"),
        google_save_url=created.get("google_save_url"),
        apple_pass=created.get("apple_pass"),
    )
