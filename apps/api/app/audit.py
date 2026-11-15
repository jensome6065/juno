"""Append-only security audit trail for decisions and webhook outcomes."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select

from app.db import SessionLocal, init_db
from app.models.tables import AuditEventRow


def append_audit(
    *,
    action: str,
    outcome: str,
    detail: str = "",
    source: Optional[str] = None,
    authorization_id: Optional[str] = None,
    http_status: Optional[int] = None,
    merchant_name: Optional[str] = None,
    selected_card_name: Optional[str] = None,
) -> dict[str, Any]:
    init_db()
    with SessionLocal() as session:
        row = AuditEventRow(
            action=action,
            outcome=outcome,
            detail=(detail or "")[:512],
            source=source,
            authorization_id=authorization_id,
            http_status=http_status,
            merchant_name=merchant_name,
            selected_card_name=selected_card_name,
            created_at=datetime.now(timezone.utc),
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        return _to_dict(row)


def list_audit(limit: int = 40) -> list[dict[str, Any]]:
    init_db()
    with SessionLocal() as session:
        rows = session.scalars(
            select(AuditEventRow).order_by(AuditEventRow.id.desc()).limit(limit)
        ).all()
        return [_to_dict(row) for row in rows]


def _to_dict(row: AuditEventRow) -> dict[str, Any]:
    return {
        "id": row.id,
        "action": row.action,
        "outcome": row.outcome,
        "detail": row.detail or "",
        "source": row.source,
        "authorization_id": row.authorization_id,
        "http_status": row.http_status,
        "merchant_name": row.merchant_name,
        "selected_card_name": row.selected_card_name,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }
