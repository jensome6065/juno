"""In-memory demo state for hour-1 Track B. Swap for Postgres later."""

from __future__ import annotations

from datetime import datetime, timezone
from threading import Lock
from typing import Any

_lock = Lock()
_spend_by_card: dict[str, float] = {}
_transactions: list[dict[str, Any]] = []
_tx_id = 0


def get_spend() -> dict[str, float]:
    with _lock:
        return dict(_spend_by_card)


def add_transaction(tx: dict[str, Any]) -> dict[str, Any]:
    global _tx_id
    with _lock:
        _tx_id += 1
        record = {
            **tx,
            "id": _tx_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        card_id = tx.get("selected_card_id")
        if card_id:
            _spend_by_card[card_id] = _spend_by_card.get(card_id, 0.0) + float(tx["amount"])
        _transactions.insert(0, record)
        return record


def list_transactions(limit: int = 50) -> list[dict[str, Any]]:
    with _lock:
        return list(_transactions[:limit])


def reset() -> None:
    global _tx_id
    with _lock:
        _spend_by_card.clear()
        _transactions.clear()
        _tx_id = 0
