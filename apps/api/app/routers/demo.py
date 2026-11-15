"""Demo helpers — wipe state and run the pitch script."""

from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.engine.score import _cap_limit
from app.events import publish
from app.schemas import CapBucketOut, CapStatusResponse, RouteScore, TransactionOut
from app.services import walletwallet
from app.services.decisions import DecisionError, route_purchase
from app.services.rules import get_card, get_merchant, load_cards, merchant_typical_amount
from app.store import get_cap_status, reset

router = APIRouter(prefix="/demo", tags=["demo"])

# Fixed auth ids so re-running the script is idempotent within a session
# after reset, and curl docs stay copy-pasteable.
SCRIPT_AUTH = {
    "coffee": "demo_script_v1_coffee",
    "gas_burn": "demo_script_v1_gas_burn",
    "coffee_in_grocery": "demo_script_v1_coffee_in_grocery",
}


class ResetResponse(BaseModel):
    ok: bool = True
    wallet_updated: bool = False


class DemoScriptRequest(BaseModel):
    reset: bool = True
    run_id: Optional[str] = Field(
        default=None,
        description="Optional suffix so parallel demos don't collide on auth ids",
    )


class DemoScriptStep(BaseModel):
    beat: int
    name: str
    merchant_id: str
    authorization_id: str
    expected_card_id: str
    transaction: TransactionOut
    scores: list[RouteScore]
    intel: Optional[dict] = None
    ok: bool
    note: str


class DemoScriptResponse(BaseModel):
    ok: bool
    reset: bool
    steps: list[DemoScriptStep]
    caps: CapStatusResponse
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


@router.post("/script", response_model=DemoScriptResponse)
def run_demo_script(body: DemoScriptRequest | None = None) -> DemoScriptResponse:
    """Run the 3-beat pitch without touching the UI.

    1. Coffee → Amex Gold (4x dining)
    2. Burn Freedom Flex rotating cap with gas ($1,500)
    3. Starbucks at Whole Foods → Amex Gold (MCC grocery, override dining)

    Fixed authorization_ids make the script idempotent after a reset.
    """
    body = body or DemoScriptRequest()
    did_reset = False
    if body.reset:
        reset()
        did_reset = True
        publish("demo.reset", {})

    suffix = f"_{body.run_id}" if body.run_id else ""
    steps: list[DemoScriptStep] = []

    # Beat 1 — coffee
    steps.append(
        _run_beat(
            beat=1,
            name="coffee",
            merchant_id="coffee",
            authorization_id=SCRIPT_AUTH["coffee"] + suffix,
            expected_card_id="amex_gold",
            note="4x dining on coffee",
        )
    )

    # Beat 2 — fill Flex rotating bucket in one gas charge
    flex = get_card("freedom_flex")
    burn_dollars = 1500.0
    if flex is not None:
        limit = _cap_limit(flex, "rotating")
        if limit:
            burn_dollars = limit / 100.0
    steps.append(
        _run_beat(
            beat=2,
            name="gas_burn",
            merchant_id="gas",
            authorization_id=SCRIPT_AUTH["gas_burn"] + suffix,
            expected_card_id="freedom_flex",
            amount=burn_dollars,
            note=f"Fill Freedom Flex rotating cap (${burn_dollars:g})",
        )
    )

    # Beat 3 — coffee counter under grocery MCC
    steps.append(
        _run_beat(
            beat=3,
            name="coffee_in_grocery",
            merchant_id="coffee_in_grocery",
            authorization_id=SCRIPT_AUTH["coffee_in_grocery"] + suffix,
            expected_card_id="amex_gold",
            note="MCC 5411 groceries → override dining → Amex Gold",
        )
    )

    wallet_updated = False
    try:
        if walletwallet.configured() and walletwallet.update_pass():
            wallet_updated = True
    except Exception:  # noqa: BLE001
        wallet_updated = False

    today = date.today()
    cards = [c for c in load_cards() if c.get("in_wallet", True)]
    raw_caps = get_cap_status(cards, today=today)
    caps = CapStatusResponse(
        as_of=today.isoformat(),
        caps={
            card_id: {key: CapBucketOut(**bucket) for key, bucket in buckets.items()}
            for card_id, buckets in raw_caps.items()
        },
    )

    ok = all(step.ok for step in steps)
    publish(
        "demo.script",
        {
            "ok": ok,
            "steps": [
                {
                    "beat": s.beat,
                    "name": s.name,
                    "merchant_id": s.merchant_id,
                    "selected_card_id": s.transaction.selected_card_id,
                    "ok": s.ok,
                }
                for s in steps
            ],
        },
    )
    return DemoScriptResponse(
        ok=ok,
        reset=did_reset,
        steps=steps,
        caps=caps,
        wallet_updated=wallet_updated,
    )


def _run_beat(
    *,
    beat: int,
    name: str,
    merchant_id: str,
    authorization_id: str,
    expected_card_id: str,
    note: str,
    amount: float | None = None,
) -> DemoScriptStep:
    merchant = get_merchant(merchant_id)
    if not merchant:
        raise HTTPException(status_code=500, detail=f"demo merchant missing: {merchant_id}")

    charge = amount if amount is not None else merchant_typical_amount(merchant)
    try:
        decision = route_purchase(
            amount=charge,
            mcc=str(merchant["mcc"]),
            merchant_name=merchant["name"],
            merchant_id=merchant["id"],
            category_hint=merchant.get("category"),
            authorization_id=authorization_id,
            source="demo_script",
        )
    except DecisionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    tx: TransactionOut = decision["transaction"]
    chosen = tx.selected_card_id
    return DemoScriptStep(
        beat=beat,
        name=name,
        merchant_id=merchant_id,
        authorization_id=authorization_id,
        expected_card_id=expected_card_id,
        transaction=tx,
        scores=decision["scores"],
        intel=decision.get("intel").model_dump() if decision.get("intel") else None,
        ok=chosen == expected_card_id,
        note=note,
    )
