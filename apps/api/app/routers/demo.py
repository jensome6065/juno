"""Demo helpers - wipe state and run the pitch script."""

from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.audit import append_audit
from app.engine.score import _cap_limit
from app.events import publish
from app.schemas import CapBucketOut, CapStatusResponse, RouteScore, TransactionOut
from app.security.demo_auth import require_demo_key
from app.services import walletwallet
from app.services.decisions import DecisionError, route_purchase
from app.services.rules import get_card, get_merchant, load_cards, merchant_typical_amount
from app.store import get_cap_status, reset

router = APIRouter(
    prefix="/demo",
    tags=["demo"],
    dependencies=[Depends(require_demo_key)],
)

# Fixed auth ids so re-running the script is idempotent within a session
# after reset, and curl docs stay copy-pasteable.
# Varied feed for the dashboard - not six identical coffees.
SCRIPT_BEATS: list[dict] = [
    {
        "name": "starbucks",
        "merchant_id": "starbucks",
        "expected_card_id": "amex_gold",
        "note": "4x dining on Starbucks",
    },
    {
        "name": "gas_burn",
        "merchant_id": "shell",
        "expected_card_id": "freedom_flex",
        "note": "Fill Freedom Flex rotating cap",
        "fill_rotating_cap": True,
    },
    {
        "name": "whole_foods",
        "merchant_id": "whole_foods",
        "expected_card_id": "amex_gold",
        "note": "Rotating cap full → Amex Gold 4x groceries",
    },
    {
        "name": "cvs",
        "merchant_id": "cvs",
        "expected_card_id": "freedom_flex",
        "note": "3x drugstore on Freedom Flex",
    },
    {
        "name": "delta",
        "merchant_id": "delta",
        "expected_card_id": "amex_gold",
        "note": "3x travel on Amex Gold",
    },
    {
        "name": "best_buy",
        "merchant_id": "best_buy",
        "expected_card_id": "double_cash",
        "note": "Uncategorized → Double Cash 2%",
    },
    {
        "name": "starbucks_whole_foods",
        "merchant_id": "starbucks_whole_foods",
        "expected_card_id": "amex_gold",
        "note": "MCC 5411 groceries → override dining → Amex Gold",
    },
]


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
    reset(keep_audit=True)
    wallet_updated = False
    try:
        if walletwallet.configured() and walletwallet.update_pass():
            wallet_updated = True
    except Exception:  # noqa: BLE001 - reset still succeeds if WalletWallet is down
        wallet_updated = False

    append_audit(
        action="demo.reset",
        outcome="ok",
        detail="Spend state wiped; audit trail kept",
        source="demo",
    )
    publish("demo.reset", {})
    return ResetResponse(ok=True, wallet_updated=wallet_updated)


@router.post("/script", response_model=DemoScriptResponse)
def run_demo_script(body: Optional[DemoScriptRequest] = None) -> DemoScriptResponse:
    """Seed a varied pitch history (coffee, gas, grocery, drugstore, flight, …).

    Fixed authorization_ids make the script idempotent after a reset.
    """
    body = body or DemoScriptRequest()
    did_reset = False
    if body.reset:
        reset(keep_audit=True)
        did_reset = True
        append_audit(
            action="demo.reset",
            outcome="ok",
            detail="Pitch seed reset; audit trail kept",
            source="demo_script",
        )
        publish("demo.reset", {})

    suffix = f"_{body.run_id}" if body.run_id else ""
    steps: list[DemoScriptStep] = []

    flex = get_card("freedom_flex")
    burn_dollars = 1500.0
    if flex is not None:
        limit = _cap_limit(flex, "rotating")
        if limit:
            burn_dollars = limit / 100.0

    for index, beat in enumerate(SCRIPT_BEATS, start=1):
        amount = burn_dollars if beat.get("fill_rotating_cap") else None
        note = beat["note"]
        if beat.get("fill_rotating_cap"):
            note = f"Fill Freedom Flex rotating cap (${burn_dollars:g})"
        steps.append(
            _run_beat(
                beat=index,
                name=beat["name"],
                merchant_id=beat["merchant_id"],
                authorization_id=f"demo_script_v2_{beat['name']}{suffix}",
                expected_card_id=beat["expected_card_id"],
                amount=amount,
                note=note,
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
