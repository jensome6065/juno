from fastapi import APIRouter, HTTPException

from app.engine.merchant_intel import resolve_category
from app.schemas import (
    InferRequest,
    InferResponse,
    MerchantOut,
    SimulateRequest,
    SimulateResponse,
)
from app.services import walletwallet
from app.services.decisions import DecisionError, route_purchase
from app.services.rules import get_merchant, load_merchants, merchant_typical_amount

router = APIRouter(tags=["simulate"])


@router.get("/merchants", response_model=list[MerchantOut])
def list_merchants() -> list[MerchantOut]:
    """Demo shortcuts only - not an exhaustive merchant catalog."""
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


@router.post("/infer", response_model=InferResponse)
def infer_category(body: InferRequest) -> InferResponse:
    """Preview how the DE maps a free-text merchant + MCC → reward category."""
    hit = resolve_category(body.mcc, body.merchant_name)
    return InferResponse(
        category=str(hit["category"]),
        confidence=float(hit["confidence"]),
        source=str(hit["source"]),
        override_id=hit.get("override_id"),
        mcc_category=hit.get("mcc_category"),
        mcc=str(body.mcc),
        merchant_name=body.merchant_name.strip(),
    )


@router.post("/simulate", response_model=SimulateResponse)
def simulate(body: SimulateRequest) -> SimulateResponse:
    merchant_id = None
    merchant_name: str
    mcc: str
    amount: float

    if body.merchant_id:
        merchant = get_merchant(body.merchant_id)
        if not merchant:
            raise HTTPException(status_code=404, detail="merchant not found")
        merchant_id = merchant["id"]
        merchant_name = merchant["name"]
        mcc = str(merchant["mcc"])
        amount = body.amount if body.amount is not None else merchant_typical_amount(merchant)
    else:
        # Free-text path: never trust a client category - DE infers from name + MCC.
        merchant_name = (body.merchant_name or "").strip()
        mcc = str(body.mcc or "").strip()
        if not merchant_name or not mcc:
            raise HTTPException(status_code=400, detail="merchant_name and mcc required")
        if body.amount is None:
            raise HTTPException(status_code=400, detail="amount required for free-text merchants")
        amount = float(body.amount)

    try:
        decision = route_purchase(
            amount=amount,
            mcc=mcc,
            merchant_name=merchant_name,
            merchant_id=merchant_id,
            category_hint=None,  # always infer
            authorization_id=body.authorization_id,
            source="simulate",
            carry_months=float(body.carry_months or 0.0),
        )
    except DecisionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    wallet_updated = False
    try:
        if walletwallet.update_pass():
            wallet_updated = True
    except Exception:  # noqa: BLE001 - demo should still succeed if WalletWallet is down
        wallet_updated = False

    return SimulateResponse(
        transaction=decision["transaction"],
        scores=decision["scores"],
        intel=decision.get("intel"),
        wallet_updated=wallet_updated,
        latency_ms=decision["latency_ms"],
        signature_verified=decision.get("signature_verified", False),
        authorization_id=decision.get("authorization_id"),
        idempotent_replay=decision.get("idempotent_replay", False),
    )
