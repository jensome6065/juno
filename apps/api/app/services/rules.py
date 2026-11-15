"""Load shared card/merchant JSON (DE schema in packages/card-rules)."""

from __future__ import annotations

from typing import Any

from app.engine.score import load_cards as _load_cards
from app.engine.score import load_merchants as _load_merchants
from app.engine.score import merchant_by_id


def load_cards() -> list[dict[str, Any]]:
    return _load_cards()


def load_merchants() -> list[dict[str, Any]]:
    return _load_merchants()


def get_card(card_id: str) -> dict[str, Any] | None:
    return next((c for c in load_cards() if c["id"] == card_id), None)


def get_merchant(merchant_id: str) -> dict[str, Any] | None:
    try:
        return merchant_by_id(load_merchants(), merchant_id)
    except KeyError:
        return None


def merchant_typical_amount(merchant: dict[str, Any]) -> float:
    if "typical_amount" in merchant:
        return float(merchant["typical_amount"])
    return float(merchant["amount_cents"]) / 100.0
