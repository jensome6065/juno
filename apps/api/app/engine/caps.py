"""Period-aware bonus-spend tracking.

Each capped rate on a card has a limit and a reset period:

- Freedom Flex `rotating` → $1,500 per calendar quarter
- Amex Gold `groceries` → $25,000 per calendar year

Only spend that earns the bonus rate counts toward the bucket.
Dollars past the remaining limit earn the card's default rate and do
not consume more of the cap.
"""

from __future__ import annotations

from datetime import date
from typing import Optional

from app.engine.score import _bonus_rate, _cap_limit, _cap_period, _split_cap


def period_id(period: str, today: Optional[date] = None) -> str:
    today = today or date.today()
    if period == "quarter":
        quarter = (today.month - 1) // 3 + 1
        return f"{today.year}-Q{quarter}"
    if period == "calendar_year":
        return str(today.year)
    if period == "month":
        return f"{today.year}-{today.month:02d}"
    if period == "lifetime":
        return "lifetime"
    raise ValueError(f"unknown cap period: {period}")


def period_bounds(period: str, today: Optional[date] = None) -> tuple[date, date]:
    """Inclusive start and exclusive end of the period containing `today`."""
    today = today or date.today()
    if period == "quarter":
        start_month = ((today.month - 1) // 3) * 3 + 1
        start = date(today.year, start_month, 1)
        if start_month == 10:
            end = date(today.year + 1, 1, 1)
        else:
            end = date(today.year, start_month + 3, 1)
        return start, end
    if period == "calendar_year":
        return date(today.year, 1, 1), date(today.year + 1, 1, 1)
    if period == "month":
        start = date(today.year, today.month, 1)
        if today.month == 12:
            end = date(today.year + 1, 1, 1)
        else:
            end = date(today.year, today.month + 1, 1)
        return start, end
    if period == "lifetime":
        return date.min, date.max
    raise ValueError(f"unknown cap period: {period}")


def caps_for_scoring(
    cards: list,
    ledger: dict,
    today: Optional[date] = None,
) -> dict[str, dict[str, int]]:
    """Build `{card_id: {cap_key: spent_cents}}` for the current periods.

    `ledger` keys are `"card_id|cap_key|period_id"` → spent cents.
    """
    today = today or date.today()
    out: dict[str, dict[str, int]] = {}
    for card in cards:
        for key in card.get("caps") or {}:
            period = _cap_period(card, key)
            pid = period_id(period, today)
            spent = int(ledger.get(_ledger_key(card["id"], key, pid), 0))
            out.setdefault(card["id"], {})[key] = spent
    return out


def apply_purchase(
    ledger: dict,
    card: dict,
    category: str,
    amount_cents: int,
    today: Optional[date] = None,
) -> dict:
    """Credit bonus spend toward the card's capped bucket for this purchase.

    Returns a summary of what was applied. Mutates `ledger` in place.
    """
    today = today or date.today()
    amount_cents = int(amount_cents)
    bonus_key, bonus_rate = _bonus_rate(card, category)
    default_rate = float(card["rates"]["default"])
    limit = _cap_limit(card, bonus_key)
    if limit is None:
        return {
            "card_id": card["id"],
            "cap_key": None,
            "credited_cents": 0,
            "period_id": None,
            "spent_cents": 0,
            "limit_cents": None,
        }

    period = _cap_period(card, bonus_key)
    pid = period_id(period, today)
    key = _ledger_key(card["id"], bonus_key, pid)
    already = int(ledger.get(key, 0))
    bonus_cents, _default_cents = _split_cap(
        amount_cents, limit, already, bonus_rate, default_rate
    )
    ledger[key] = already + bonus_cents
    return {
        "card_id": card["id"],
        "cap_key": bonus_key,
        "credited_cents": bonus_cents,
        "period_id": pid,
        "spent_cents": ledger[key],
        "limit_cents": limit,
        "remaining_cents": max(0, limit - ledger[key]),
    }


def remaining_cents(card: dict, cap_key: str, ledger: dict, today: Optional[date] = None) -> int:
    today = today or date.today()
    limit = _cap_limit(card, cap_key)
    if limit is None:
        return 0
    pid = period_id(_cap_period(card, cap_key), today)
    spent = int(ledger.get(_ledger_key(card["id"], cap_key, pid), 0))
    return max(0, limit - spent)


def _ledger_key(card_id: str, cap_key: str, pid: str) -> str:
    return f"{card_id}|{cap_key}|{pid}"
