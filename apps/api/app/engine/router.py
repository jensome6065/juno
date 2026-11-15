"""Thin adapter over the DE scorer (`score.py`) for the simulate API."""

from __future__ import annotations

from datetime import date
from typing import Any, Optional

from app.engine.score import select_card


def pick_best_card(
    cards: list[dict[str, Any]],
    amount: float,
    mcc: str,
    category: str,  # noqa: ARG001 — MCC map decides category in score.py
    spend_by_card: dict[str, float] | None = None,  # noqa: ARG001 — kept for callers
    caps: dict[str, dict[str, int]] | None = None,
    today: Optional[date] = None,
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    """Return (best, scores, default) in dollars for the HTTP layer.

    Prefer `caps` = `{card_id: {cap_key: spent_cents}}` for the current
    period. `spend_by_card` is ignored for scoring; it remains on the
    signature so existing simulate callers do not break mid-refactor.
    """
    amount_cents = int(round(float(amount) * 100))
    result = select_card(cards, amount_cents, mcc, caps=caps or {}, today=today)

    scores = [
        {
            "card_id": row["card_id"],
            "card_name": row["name"],
            "value": round(float(row["reward_cents"]) / 100.0, 4),
            "rate_used": float(row["rate"]),
            "reason": row["reason"],
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
