"""Shared authorization decision path for simulate + Stripe webhooks."""

from __future__ import annotations

import time
from typing import Any, Optional

from app.engine.router import pick_best_card
from app.events import publish
from app.schemas import DecisionIntel, RouteScore, TransactionOut
from app.services.rules import get_card, load_cards
from app.store import add_transaction, get_caps, get_transaction_by_authorization


class DecisionError(Exception):
    pass


def _transaction_out(tx: dict[str, Any]) -> TransactionOut:
    payload = dict(tx)
    if not payload.get("created_at"):
        payload["created_at"] = ""
    return TransactionOut(**payload)


def route_purchase(
    *,
    amount: float,
    mcc: str,
    merchant_name: str,
    merchant_id: Optional[str] = None,
    category_hint: Optional[str] = None,
    authorization_id: Optional[str] = None,
    source: str = "simulate",
) -> dict[str, Any]:
    """Score linked cards, persist once, publish SSE. Idempotent on authorization_id."""
    if amount <= 0:
        raise DecisionError("amount must be positive")

    if authorization_id:
        existing = get_transaction_by_authorization(authorization_id)
        if existing:
            best, scores, default = _score_only(
                amount=amount,
                mcc=mcc,
                merchant_name=merchant_name,
                category_hint=category_hint,
            )
            return {
                "transaction": _transaction_out(existing),
                "scores": [RouteScore(**s) for s in scores],
                "intel": _intel_from_best(best, existing),
                "latency_ms": 0.0,
                "signature_verified": source == "stripe_webhook",
                "authorization_id": authorization_id,
                "idempotent_replay": True,
            }

    cards = [c for c in load_cards() if c.get("in_wallet", True)]
    if not cards:
        raise DecisionError("no cards configured")

    started = time.perf_counter()
    best, scores, default = pick_best_card(
        cards,
        amount,
        mcc,
        category_hint or "other",
        caps=get_caps(cards),
        merchant_name=merchant_name,
    )
    category = best.get("category") or category_hint or "other"
    chosen = get_card(best["card_id"])
    tx = add_transaction(
        {
            "authorization_id": authorization_id,
            "merchant_name": merchant_name,
            "merchant_id": merchant_id,
            "mcc": mcc,
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
            "source": source,
        },
        card=chosen,
    )
    latency_ms = round((time.perf_counter() - started) * 1000, 2)
    replay = bool(tx.get("idempotent_replay"))
    transaction = _transaction_out(tx)

    decision = {
        "transaction": transaction,
        "scores": [RouteScore(**s) for s in scores],
        "intel": _intel_from_best(best, tx),
        "latency_ms": latency_ms,
        "signature_verified": source == "stripe_webhook",
        "authorization_id": authorization_id,
        "idempotent_replay": replay,
    }

    if not replay:
        publish(
            "decision.created",
            {
                "transaction": transaction.model_dump(),
                "scores": scores,
                "latency_ms": latency_ms,
                "authorization_id": authorization_id,
                "source": source,
            },
        )
    return decision


def _score_only(
    *,
    amount: float,
    mcc: str,
    merchant_name: str,
    category_hint: Optional[str],
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    cards = [c for c in load_cards() if c.get("in_wallet", True)]
    return pick_best_card(
        cards,
        amount,
        mcc,
        category_hint or "other",
        caps=get_caps(cards),
        merchant_name=merchant_name,
    )


def _intel_from_best(
    best: dict[str, Any],
    tx: Optional[dict[str, Any]] = None,
) -> DecisionIntel:
    tx = tx or {}
    return DecisionIntel(
        category=str(best.get("category") or tx.get("category") or "other"),
        category_source=str(
            best.get("category_source") or tx.get("category_source") or "mcc"
        ),
        category_confidence=(
            float(best["category_confidence"])
            if best.get("category_confidence") is not None
            else (
                float(tx["category_confidence"])
                if tx.get("category_confidence") is not None
                else None
            )
        ),
        mcc_category=best.get("mcc_category"),
        override_id=best.get("override_id"),
        winner_cap_split=bool(best.get("cap_split")),
    )
