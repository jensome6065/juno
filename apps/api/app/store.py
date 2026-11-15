"""Durable store: transactions + cap ledger + pass state.

Uses SQLAlchemy (Postgres in docker / SQLite for tests). Authorization
replays with the same `authorization_id` return the existing row and do
not double-credit caps. Raw PANs are never accepted or stored.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any, Optional

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.db import SessionLocal, get_engine, init_db, reset_engine
from app.engine.caps import apply_purchase, cap_status, caps_for_scoring
from app.models.tables import Base, CapLedgerRow, PassStateRow, TransactionRow

# Tables wiped by demo reset. Audit trail is intentionally excluded.
_DEMO_RESET_TABLES = (TransactionRow, CapLedgerRow, PassStateRow)

FORBIDDEN_PAN_KEYS = frozenset(
    {
        "pan",
        "primary_account_number",
        "card_number",
        "full_pan",
        "cvv",
        "cvc",
        "cvv2",
        "track1",
        "track2",
        "magnetic_stripe",
    }
)


def _reject_pan(payload: dict[str, Any]) -> None:
    banned = FORBIDDEN_PAN_KEYS.intersection(k.lower() for k in payload)
    if banned:
        raise ValueError(f"refusing to persist sensitive card data: {sorted(banned)}")


def _ledger_dict(session) -> dict[str, int]:
    out: dict[str, int] = {}
    for row in session.scalars(select(CapLedgerRow)).all():
        out[f"{row.card_id}|{row.cap_key}|{row.period_id}"] = int(row.spent_cents)
    return out


def _tx_to_dict(row: TransactionRow) -> dict[str, Any]:
    return {
        "id": row.id,
        "authorization_id": row.authorization_id,
        "merchant_name": row.merchant_name,
        "merchant_id": row.merchant_id,
        "mcc": row.mcc,
        "category": row.category,
        "category_confidence": row.category_confidence,
        "category_source": row.category_source,
        "amount": row.amount_cents / 100.0,
        "amount_cents": row.amount_cents,
        "selected_card_id": row.selected_card_id,
        "selected_card_name": row.selected_card_name,
        "selected_last4": row.selected_last4,
        "default_card_name": row.default_card_name,
        "reward_value": row.reward_value_cents / 100.0,
        "default_reward_value": row.default_reward_value_cents / 100.0,
        "extra_value": row.extra_value_cents / 100.0,
        "reason": row.reason,
        "cap_key": row.cap_key,
        "cap_credited_cents": row.cap_credited_cents,
        "cap_period_id": row.cap_period_id,
        "cap_remaining_cents": row.cap_remaining_cents,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "idempotent_replay": False,
    }


def get_spend() -> dict[str, float]:
    """Total dollars charged to each linked card (UI / CardOut)."""
    init_db()
    with SessionLocal() as session:
        spend: dict[str, float] = {}
        for row in session.scalars(select(TransactionRow)).all():
            spend[row.selected_card_id] = spend.get(row.selected_card_id, 0.0) + (
                row.amount_cents / 100.0
            )
        return spend


def get_cap_ledger() -> dict[str, int]:
    init_db()
    with SessionLocal() as session:
        return _ledger_dict(session)


def get_caps(cards: list[dict[str, Any]], today: Optional[date] = None) -> dict[str, dict[str, int]]:
    init_db()
    with SessionLocal() as session:
        return caps_for_scoring(cards, _ledger_dict(session), today=today)


def get_cap_status(
    cards: list[dict[str, Any]],
    today: Optional[date] = None,
) -> dict[str, dict[str, dict]]:
    """UI-ready cap meters: spent / limit / remaining / period per card bucket."""
    init_db()
    with SessionLocal() as session:
        return cap_status(cards, _ledger_dict(session), today=today)


def get_pass_state() -> dict[str, Any]:
    init_db()
    with SessionLocal() as session:
        row = session.scalars(select(PassStateRow).limit(1)).first()
        if not row:
            return {}
        return {
            "serial_number": row.serial_number,
            "share_url": row.share_url,
            "google_save_url": row.google_save_url,
            "apple_pass_path": row.apple_pass_path,
        }


def set_pass_state(state: dict[str, Any]) -> dict[str, Any]:
    init_db()
    with SessionLocal() as session:
        row = session.scalars(select(PassStateRow).limit(1)).first()
        if row is None:
            row = PassStateRow()
            session.add(row)
        row.serial_number = state.get("serial_number")
        row.share_url = state.get("share_url")
        row.google_save_url = state.get("google_save_url")
        row.apple_pass_path = state.get("apple_pass_path")
        row.updated_at = datetime.now(timezone.utc)
        session.commit()
        return get_pass_state()


def get_transaction_by_authorization(authorization_id: str) -> Optional[dict[str, Any]]:
    init_db()
    with SessionLocal() as session:
        row = session.scalars(
            select(TransactionRow).where(TransactionRow.authorization_id == authorization_id)
        ).first()
        return _tx_to_dict(row) if row else None


def add_transaction(
    tx: dict[str, Any],
    card: Optional[dict[str, Any]] = None,
    today: Optional[date] = None,
) -> dict[str, Any]:
    """Persist a routed purchase. Same authorization_id → one row, no double credit."""
    _reject_pan(tx)
    init_db()
    authorization_id = tx.get("authorization_id")
    today = today or date.today()

    with SessionLocal() as session:
        if authorization_id:
            existing = session.scalars(
                select(TransactionRow).where(TransactionRow.authorization_id == authorization_id)
            ).first()
            if existing is not None:
                out = _tx_to_dict(existing)
                out["idempotent_replay"] = True
                return out

        amount = float(tx["amount"])
        amount_cents = int(tx.get("amount_cents") or round(amount * 100))
        cap_update: dict[str, Any] = {
            "cap_key": None,
            "credited_cents": 0,
            "period_id": None,
            "remaining_cents": None,
        }

        if card is not None:
            ledger = _ledger_dict(session)
            cap_update = apply_purchase(
                ledger,
                card,
                str(tx.get("category") or "other"),
                amount_cents,
                today=today,
            )
            if cap_update.get("cap_key") and cap_update.get("period_id"):
                _upsert_cap(
                    session,
                    card_id=card["id"],
                    cap_key=cap_update["cap_key"],
                    period_id=cap_update["period_id"],
                    spent_cents=int(cap_update["spent_cents"]),
                )

        row = TransactionRow(
            authorization_id=authorization_id,
            merchant_name=tx["merchant_name"],
            merchant_id=tx.get("merchant_id"),
            mcc=str(tx["mcc"]),
            category=str(tx["category"]),
            category_confidence=tx.get("category_confidence"),
            category_source=tx.get("category_source"),
            amount_cents=amount_cents,
            selected_card_id=tx["selected_card_id"],
            selected_card_name=tx["selected_card_name"],
            selected_last4=(card or {}).get("last4") if card else tx.get("selected_last4"),
            default_card_name=tx["default_card_name"],
            reward_value_cents=float(tx["reward_value"]) * 100.0,
            default_reward_value_cents=float(tx["default_reward_value"]) * 100.0,
            extra_value_cents=float(tx["extra_value"]) * 100.0,
            reason=tx["reason"],
            cap_key=cap_update.get("cap_key"),
            cap_credited_cents=cap_update.get("credited_cents", 0),
            cap_period_id=cap_update.get("period_id"),
            cap_remaining_cents=cap_update.get("remaining_cents"),
        )
        session.add(row)
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            if not authorization_id:
                raise
            existing = session.scalars(
                select(TransactionRow).where(TransactionRow.authorization_id == authorization_id)
            ).first()
            if existing is None:
                raise
            out = _tx_to_dict(existing)
            out["idempotent_replay"] = True
            return out

        session.refresh(row)
        return _tx_to_dict(row)


def _upsert_cap(session, card_id: str, cap_key: str, period_id: str, spent_cents: int) -> None:
    row = session.scalars(
        select(CapLedgerRow).where(
            CapLedgerRow.card_id == card_id,
            CapLedgerRow.cap_key == cap_key,
            CapLedgerRow.period_id == period_id,
        )
    ).first()
    if row is None:
        session.add(
            CapLedgerRow(
                card_id=card_id,
                cap_key=cap_key,
                period_id=period_id,
                spent_cents=spent_cents,
            )
        )
    else:
        row.spent_cents = spent_cents
        row.updated_at = datetime.now(timezone.utc)


def list_transactions(limit: int = 50) -> list[dict[str, Any]]:
    init_db()
    with SessionLocal() as session:
        rows = session.scalars(
            select(TransactionRow).order_by(TransactionRow.id.desc()).limit(limit)
        ).all()
        return [_tx_to_dict(row) for row in rows]


def reset(*, keep_audit: bool = False) -> None:
    """Wipe durable state (demo reset / tests).

    Demo pitch reseeds pass keep_audit=True so webhook rejects stay visible.
    """
    init_db()
    engine = get_engine()
    if keep_audit:
        with SessionLocal() as session:
            for model in _DEMO_RESET_TABLES:
                session.execute(delete(model))
            session.commit()
        return
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


def configure_test_db(url: str = "sqlite+pysqlite:///:memory:") -> None:
    """Point the store at an isolated DB (call before other store ops in tests)."""
    import os

    try:
        get_engine().dispose()
    except Exception:  # noqa: BLE001 - engine may not exist yet
        pass
    os.environ["DATABASE_URL"] = url
    reset_engine()
    init_db()
