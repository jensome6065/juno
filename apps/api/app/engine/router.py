"""Thin adapter over the DE scorer for the simulate API."""

from __future__ import annotations

from datetime import date
from typing import Any, Optional

from app.engine.decide import Constraints, decide


def pick_best_card(
    cards: list[dict[str, Any]],
    amount: float,
    mcc: str,
    category: str,  # noqa: ARG001 — merchant intel / MCC decide category
    spend_by_card: dict[str, float] | None = None,  # noqa: ARG001 — legacy
    caps: dict[str, dict[str, int]] | None = None,
    today: Optional[date] = None,
    merchant_name: str = "",
    denylist: list[str] | None = None,
    max_apr: float | None = None,
    carry_months: float = 0.0,
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    """Return (best, scores, default) in dollars for the HTTP layer."""
    amount_cents = int(round(float(amount) * 100))
    result = decide(
        cards,
        amount_cents,
        mcc=str(mcc),
        merchant_name=merchant_name,
        constraints=Constraints.from_parts(
            caps=caps,
            denylist=denylist,
            max_apr=max_apr,
            carry_months=carry_months,
            today=today,
        ),
    )

    scores = [
        {
            "card_id": row["card_id"],
            "card_name": row["name"],
            "value": round(float(row["reward_cents"]) / 100.0, 4)
            if row.get("eligible", True)
            else 0.0,
            "rate_used": float(row.get("rate") or 0.0),
            "reason": row["reason"],
            "rank": row.get("rank"),
            "eligible": bool(row.get("eligible", True)),
            "constraint": row.get("constraint"),
        }
        for row in result["ranking"]
    ]
    best = {
        "card_id": result["card_id"],
        "card_name": result["name"],
        "value": round(float(result["reward_cents"]) / 100.0, 4),
        "rate_used": float(result["ranking"][0]["rate"]),
        "reason": result["reason"],
        "category": result["category"],
        "category_confidence": result.get("category_confidence"),
        "category_source": result.get("category_source"),
        "bonus_cents": int(result["ranking"][0].get("bonus_cents") or 0),
    }
    default = {
        "card_id": "baseline",
        "card_name": "1% baseline",
        "value": round(float(result["baseline_value_cents"]) / 100.0, 4),
        "rate_used": 1.0,
        "reason": "1% everywhere",
    }
    return best, scores, default
