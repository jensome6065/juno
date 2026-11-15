import time

from fastapi import APIRouter, HTTPException

from app.engine.router import pick_best_card
from app.schemas import MerchantOut, RouteScore, SimulateRequest, SimulateResponse, TransactionOut
from app.services import walletwallet
from app.services.rules import get_card, get_merchant, load_cards, load_merchants, merchant_typical_amount
from app.store import add_transaction, get_caps

router = APIRouter(tags=["simulate"])


@router.get("/merchants", response_model=list[MerchantOut])
def list_merchants() -> list[MerchantOut]:
    return [
        MerchantOut(
            id=m["id"],
            name=m["name"],
            mcc=m["mcc"],
            category=m["category"],
            typical_amount=merchant_typical_amount(m),
        )
        for m in load_merchants()
    ]


@router.post("/simulate", response_model=SimulateResponse)
def simulate(body: SimulateRequest) -> SimulateResponse:
    merchant = get_merchant(body.merchant_id)
    if not merchant:
        raise HTTPException(status_code=404, detail="merchant not found")

    cards = [c for c in load_cards() if c.get("in_wallet", True)]
    if not cards:
        raise HTTPException(status_code=400, detail="no cards configured")

    amount = body.amount if body.amount is not None else merchant_typical_amount(merchant)

    # Time the authorization-critical path only (score + persist), not WalletWallet I/O.
    started = time.perf_counter()
    best, scores, default = pick_best_card(
        cards,
        amount,
        merchant["mcc"],
        merchant["category"],
        caps=get_caps(cards),
        merchant_name=merchant["name"],
    )

    # Category may come from MCC or a merchant_overrides hit (coffee-in-grocery).
    category = best.get("category") or merchant["category"]
    chosen = get_card(best["card_id"])
    tx = add_transaction(
        {
            "authorization_id": body.authorization_id,
            "merchant_name": merchant["name"],
            "merchant_id": merchant["id"],
            "mcc": merchant["mcc"],
            "category": category,
            "category_confidence": best.get("category_confidence"),
            "category_source": best.get("category_source"),
            "amount": amount,
            "selected_card_id": best["card_id"],
            "selected_card_name": best["card_name"],
            "default_card_name": default["card_name"],
            "reward_value": best["value"],
            "default_reward_value": default["value"],
            "extra_value": round(best["value"] - default["value"], 4),
            "reason": best["reason"],
        },
        card=chosen,
    )
    latency_ms = round((time.perf_counter() - started) * 1000, 2)

    wallet_updated = False
    try:
        if walletwallet.update_pass():
            wallet_updated = True
    except Exception:  # noqa: BLE001 — demo should still succeed if WalletWallet is down
        wallet_updated = False

    return SimulateResponse(
        transaction=TransactionOut(**tx),
        scores=[RouteScore(**s) for s in scores],
        wallet_updated=wallet_updated,
        latency_ms=latency_ms,
    )
