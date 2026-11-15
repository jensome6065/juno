"""Demo-facing security status + audit trail for the Most Secure Hack pitch."""

from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.audit import list_audit
from app.security.demo_auth import demo_key_configured

router = APIRouter(prefix="/security", tags=["security"])


class SecurityStatus(BaseModel):
    stripe_webhook_secret_configured: bool
    stripe_api_key_configured: bool
    demo_api_key_configured: bool
    signature_required: bool = True
    stores_raw_pan: bool = False
    idempotent_authorizations: bool = True
    realtime_decision_stream: bool = True
    audit_log_enabled: bool = True
    rate_limit_enabled: bool = True
    webhook_path: str = "/webhooks/stripe"


class AuditEventOut(BaseModel):
    id: int
    action: str
    outcome: str
    detail: str = ""
    source: Optional[str] = None
    authorization_id: Optional[str] = None
    http_status: Optional[int] = None
    merchant_name: Optional[str] = None
    selected_card_name: Optional[str] = None
    created_at: Optional[str] = None


@router.get("/status", response_model=SecurityStatus)
def security_status() -> SecurityStatus:
    return SecurityStatus(
        stripe_webhook_secret_configured=bool(
            os.getenv("STRIPE_WEBHOOK_SECRET", "").strip()
        ),
        stripe_api_key_configured=bool(os.getenv("STRIPE_SECRET_KEY", "").strip()),
        demo_api_key_configured=demo_key_configured(),
    )


@router.get("/audit", response_model=list[AuditEventOut])
def security_audit(limit: int = Query(default=40, ge=1, le=200)) -> list[AuditEventOut]:
    return [AuditEventOut(**row) for row in list_audit(limit=limit)]
