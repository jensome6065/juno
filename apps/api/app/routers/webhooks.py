"""Stripe Issuing authorization webhook — signature verified, idempotent."""

from __future__ import annotations

import os
from typing import Any, Optional

import stripe
from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel
from stripe import Webhook
from stripe.issuing import Authorization

from app.services.decisions import DecisionError, route_purchase
from app.services import walletwallet

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


class StripeWebhookStatus(BaseModel):
    configured: bool
    secret_configured: bool
    api_key_configured: bool


@router.get("/stripe/status", response_model=StripeWebhookStatus)
def stripe_webhook_status() -> StripeWebhookStatus:
    return StripeWebhookStatus(
        configured=bool(os.getenv("STRIPE_WEBHOOK_SECRET", "").strip()),
        secret_configured=bool(os.getenv("STRIPE_WEBHOOK_SECRET", "").strip()),
        api_key_configured=bool(os.getenv("STRIPE_SECRET_KEY", "").strip()),
    )


@router.post("/stripe")
async def stripe_webhook(
    request: Request,
    stripe_signature: Optional[str] = Header(default=None, alias="Stripe-Signature"),
) -> dict[str, Any]:
    secret = os.getenv("STRIPE_WEBHOOK_SECRET", "").strip()
    if not secret:
        raise HTTPException(
            status_code=503,
            detail="STRIPE_WEBHOOK_SECRET is not configured",
        )
    if not stripe_signature:
        raise HTTPException(status_code=400, detail="Missing Stripe-Signature header")

    payload = await request.body()
    try:
        event = Webhook.construct_event(payload, stripe_signature, secret)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid payload") from exc
    except stripe.SignatureVerificationError as exc:
        raise HTTPException(status_code=400, detail="Invalid signature") from exc

    event_type = event["type"] if isinstance(event, dict) else event.type
    if event_type != "issuing_authorization.request":
        return {
            "received": True,
            "ignored": event_type,
            "signature_verified": True,
        }

    auth = event["data"]["object"] if isinstance(event, dict) else event.data.object
    auth_obj = auth if isinstance(auth, dict) else auth.to_dict()
    authorization_id = str(auth_obj.get("id") or "")
    amount_cents = _authorization_amount_cents(auth_obj)
    merchant = auth_obj.get("merchant_data") or {}
    mcc = str(merchant.get("category_code") or "0000")
    merchant_name = str(merchant.get("name") or "Stripe merchant")

    try:
        decision = route_purchase(
            amount=amount_cents / 100.0,
            mcc=mcc,
            merchant_name=merchant_name,
            authorization_id=authorization_id or None,
            source="stripe_webhook",
        )
    except DecisionError as exc:
        _decline_authorization(authorization_id)
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    approved = _approve_authorization(authorization_id)

    try:
        walletwallet.update_pass()
    except Exception:  # noqa: BLE001
        pass

    return {
        "received": True,
        "signature_verified": True,
        "approved": approved,
        "idempotent_replay": decision.get("idempotent_replay", False),
        "authorization_id": authorization_id,
        "selected_card": decision["transaction"].selected_card_name,
        "latency_ms": decision["latency_ms"],
        "reason": decision["transaction"].reason,
    }


def _authorization_amount_cents(auth: dict[str, Any]) -> int:
    pending = auth.get("pending_request") or {}
    if pending.get("amount") is not None:
        return int(pending["amount"])
    return int(auth.get("amount") or 0)


def _approve_authorization(authorization_id: str) -> bool:
    api_key = os.getenv("STRIPE_SECRET_KEY", "").strip()
    if not api_key or not authorization_id:
        return False
    stripe.api_key = api_key
    try:
        Authorization.approve(authorization_id)
        return True
    except Exception:  # noqa: BLE001 — still record local decision for demo/logs
        return False


def _decline_authorization(authorization_id: str) -> None:
    api_key = os.getenv("STRIPE_SECRET_KEY", "").strip()
    if not api_key or not authorization_id:
        return
    stripe.api_key = api_key
    try:
        Authorization.decline(authorization_id)
    except Exception:  # noqa: BLE001
        return
