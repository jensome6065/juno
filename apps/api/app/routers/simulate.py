from fastapi import APIRouter, HTTPException

from app.schemas import MerchantOut, SimulateRequest, SimulateResponse
from app.services import walletwallet
from app.services.decisions import DecisionError, route_purchase
from app.services.rules import get_merchant, load_merchants, merchant_typical_amount

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

    amount = body.amount if body.amount is not None else merchant_typical_amount(merchant)
    try:
        decision = route_purchase(
            amount=amount,
            mcc=str(merchant["mcc"]),
            merchant_name=merchant["name"],
            merchant_id=merchant["id"],
            category_hint=merchant.get("category"),
            authorization_id=body.authorization_id,
            source="simulate",
        )
    except DecisionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    wallet_updated = False
    try:
        if walletwallet.update_pass():
            wallet_updated = True
    except Exception:  # noqa: BLE001 — demo should still succeed if WalletWallet is down
        wallet_updated = False

    return SimulateResponse(
        transaction=decision["transaction"],
        scores=decision["scores"],
        wallet_updated=wallet_updated,
        latency_ms=decision["latency_ms"],
        signature_verified=decision.get("signature_verified", False),
        authorization_id=decision.get("authorization_id"),
        idempotent_replay=decision.get("idempotent_replay", False),
    )
