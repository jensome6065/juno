"""Thin adapter over the DE scorer (`score.py`) for the simulate API."""

from __future__ import annotations

from typing import Any

from app.engine.score import select_card


def pick_best_card(
    cards: list[dict[str, Any]],
    amount: float,
    mcc: str,
    category: str,  # noqa: ARG001 — MCC map decides category in score.py
    spend_by_card: dict[str, float] | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    """Return (best, scores, default) in dollars for the HTTP layer."""
    amount_cents = int(round(float(amount) * 100))
    caps = _caps_from_spend(spend_by_card)
    result = select_card(cards, amount_cents, mcc, caps=caps)

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
    }
    default = {
        "card_id": "baseline",
        "card_name": "1% baseline",
        "value": round(float(result["baseline_value_cents"]) / 100.0, 4),
        "rate_used": 1.0,
        "reason": "1% everywhere",
    }
    return best, scores, default


def _caps_from_spend(spend_by_card: dict[str, float] | None) -> dict[str, dict[str, int]]:
    """Map simple dollar spend totals into a rotating/default cap bucket."""
    if not spend_by_card:
        return {}
    caps: dict[str, dict[str, int]] = {}
    for card_id, dollars in spend_by_card.items():
        caps[card_id] = {"rotating": int(round(float(dollars) * 100))}
    return caps
