"""Durable decision-engine tables.

Security invariants:
- Never store raw PAN, CVV, magstripe/track data, or full account numbers.
- `selected_last4` is the demo last4 from card-rules, not a network PAN.
- Stripe/network identities live in `authorization_id` only.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    DateTime,
    Float,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class TransactionRow(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Idempotency key for Stripe (or simulator) authorizations.
    authorization_id: Mapped[Optional[str]] = mapped_column(String(128), unique=True, index=True)

    merchant_name: Mapped[str] = mapped_column(String(255), nullable=False)
    merchant_id: Mapped[Optional[str]] = mapped_column(String(64))
    mcc: Mapped[str] = mapped_column(String(8), nullable=False)
    category: Mapped[str] = mapped_column(String(64), nullable=False)
    category_confidence: Mapped[Optional[float]] = mapped_column(Float)
    category_source: Mapped[Optional[str]] = mapped_column(String(32))

    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)

    selected_card_id: Mapped[str] = mapped_column(String(64), nullable=False)
    selected_card_name: Mapped[str] = mapped_column(String(128), nullable=False)
    selected_last4: Mapped[Optional[str]] = mapped_column(String(4))
    default_card_name: Mapped[str] = mapped_column(String(128), nullable=False)

    reward_value_cents: Mapped[float] = mapped_column(Float, nullable=False)
    default_reward_value_cents: Mapped[float] = mapped_column(Float, nullable=False)
    extra_value_cents: Mapped[float] = mapped_column(Float, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)

    cap_key: Mapped[Optional[str]] = mapped_column(String(64))
    cap_credited_cents: Mapped[Optional[int]] = mapped_column(Integer)
    cap_period_id: Mapped[Optional[str]] = mapped_column(String(32))
    cap_remaining_cents: Mapped[Optional[int]] = mapped_column(Integer)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class CapLedgerRow(Base):
    __tablename__ = "cap_ledger"
    __table_args__ = (
        UniqueConstraint("card_id", "cap_key", "period_id", name="uq_cap_bucket"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    card_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    cap_key: Mapped[str] = mapped_column(String(64), nullable=False)
    period_id: Mapped[str] = mapped_column(String(32), nullable=False)
    spent_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )


class PassStateRow(Base):
    __tablename__ = "pass_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    serial_number: Mapped[Optional[str]] = mapped_column(String(128))
    # Google Save links embed a large JWT - varchar(512) truncates them.
    share_url: Mapped[Optional[str]] = mapped_column(Text)
    google_save_url: Mapped[Optional[str]] = mapped_column(Text)
    apple_pass_path: Mapped[Optional[str]] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )
