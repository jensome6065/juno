"""In-memory demo state for hour-1 Track B. Swap for Postgres later."""

from __future__ import annotations

from datetime import date, datetime, timezone
from threading import Lock
from typing import Any, Optional

from app.engine.caps import apply_purchase, caps_for_scoring

_lock = Lock()
_spend_by_card: dict[str, float] = {}
_cap_ledger: dict[str, int] = {}
_transactions: list[dict[str, Any]] = []
_tx_id = 0
_pass_state: dict[str, Any] = {}


def get_spend() -> dict[str, float]:
    """Total dollars charged to each linked card (UI / CardOut)."""
    with _lock:
        return dict(_spend_by_card)


def get_cap_ledger() -> dict[str, int]:
    with _lock:
        return dict(_cap_ledger)


def get_caps(cards: list[dict[str, Any]], today: Optional[date] = None) -> dict[str, dict[str, int]]:
    """Current-period bonus spend, shaped for `select_card` / `choose_card`."""
    with _lock:
        return caps_for_scoring(cards, _cap_ledger, today=today)


def get_pass_state() -> dict[str, Any]:
    with _lock:
        return dict(_pass_state)


def set_pass_state(state: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        _pass_state.clear()
        _pass_state.update(state)
        return dict(_pass_state)


def add_transaction(
    tx: dict[str, Any],
    card: Optional[dict[str, Any]] = None,
    today: Optional[date] = None,
) -> dict[str, Any]:
    global _tx_id
    with _lock:
        _tx_id += 1
        record = {
            **tx,
            "id": _tx_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        card_id = tx.get("selected_card_id")
        amount = float(tx["amount"])
        if card_id:
            _spend_by_card[card_id] = _spend_by_card.get(card_id, 0.0) + amount

        if card is not None:
            cap_update = apply_purchase(
                _cap_ledger,
                card,
                str(tx.get("category") or "other"),
                int(round(amount * 100)),
                today=today,
            )
            record["cap_key"] = cap_update.get("cap_key")
            record["cap_credited_cents"] = cap_update.get("credited_cents", 0)
            record["cap_period_id"] = cap_update.get("period_id")
            record["cap_remaining_cents"] = cap_update.get("remaining_cents")

        _transactions.insert(0, record)
        return record


def list_transactions(limit: int = 50) -> list[dict[str, Any]]:
    with _lock:
        return list(_transactions[:limit])


def reset() -> None:
    global _tx_id
    with _lock:
        _spend_by_card.clear()
        _cap_ledger.clear()
        _transactions.clear()
        _pass_state.clear()
        _tx_id = 0
