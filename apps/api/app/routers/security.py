"""Demo-facing security status for the Most Secure Hack pitch."""

from __future__ import annotations

import os

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/security", tags=["security"])


class SecurityStatus(BaseModel):
    stripe_webhook_secret_configured: bool
    stripe_api_key_configured: bool
    signature_required: bool = True
    stores_raw_pan: bool = False
    idempotent_authorizations: bool = True
    realtime_decision_stream: bool = True
    webhook_path: str = "/webhooks/stripe"


@router.get("/status", response_model=SecurityStatus)
def security_status() -> SecurityStatus:
    return SecurityStatus(
        stripe_webhook_secret_configured=bool(
            os.getenv("STRIPE_WEBHOOK_SECRET", "").strip()
        ),
        stripe_api_key_configured=bool(os.getenv("STRIPE_SECRET_KEY", "").strip()),
    )
