"""WalletWallet pass create/update for the Juno card in Apple/Google Wallet."""

from __future__ import annotations

import os
from typing import Any

import httpx

from app.store import get_pass_state, list_transactions, set_pass_state

BASE_URL = "https://api.walletwallet.dev"


def configured() -> bool:
    return bool(os.getenv("WALLETWALLET_API_KEY", "").strip())


def _headers() -> dict[str, str]:
    key = os.getenv("WALLETWALLET_API_KEY", "").strip()
    if not key:
        raise RuntimeError("WALLETWALLET_API_KEY is not set")
    return {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def _money(n: float) -> str:
    return f"${n:,.2f}"


def build_pass_body() -> dict[str, Any]:
    txs = list_transactions(limit=1)
    last = txs[0] if txs else None
    extra_total = sum(float(t.get("extra_value") or 0) for t in list_transactions(limit=200))

    if last:
        routed = last["selected_card_name"]
        merchant = last["merchant_name"]
        extra = _money(float(last["extra_value"]))
        notification = f"Routed to {routed} · +{extra} vs baseline"
        primary_change = "Juno routed this tap to %@"
    else:
        routed = "Ready to tap"
        merchant = "No purchases yet"
        extra = _money(0)
        notification = "Add Juno to Wallet, then tap at the demo terminal"
        primary_change = "Juno update: %@"

    return {
        "logoText": "JUNO",
        "organizationName": "Juno",
        "description": "Juno smart rewards card",
        "colorPreset": "green",
        "sharingProhibited": False,
        "expirationDays": 90,
        "notification": notification,
        "headerFields": [{"label": "CARD", "value": "Virtual"}],
        "primaryFields": [
            {
                "label": "ROUTES TO",
                "value": routed,
                "changeMessage": primary_change,
            }
        ],
        "secondaryFields": [
            {"label": "LAST TAP", "value": merchant},
            {"label": "EXTRA EARNED", "value": _money(extra_total)},
        ],
        "backFields": [
            {
                "label": "About",
                "value": "Juno stands in for your linked cards and routes each purchase to the best rewards.",
            },
            {
                "label": "Demo",
                "value": "Use the Juno web terminal to simulate a phone tap. This Wallet pass updates after each route.",
            },
        ],
        "barcodeValue": "juno-demo",
        "barcodeFormat": "QR",
        "barcodeAltText": "Juno demo",
    }


def create_pass() -> dict[str, Any]:
    with httpx.Client(timeout=30.0) as client:
        res = client.post(
            f"{BASE_URL}/api/passes",
            headers=_headers(),
            json=build_pass_body(),
        )
        if res.status_code >= 400:
            raise RuntimeError(f"WalletWallet create failed ({res.status_code}): {res.text}")
        data = res.json()

    set_pass_state(
        {
            "serial_number": data.get("serialNumber"),
            "share_url": data.get("shareUrl"),
            "google_save_url": data.get("googleSaveUrl"),
        }
    )
    return {
        "serial_number": data.get("serialNumber"),
        "share_url": data.get("shareUrl"),
        "google_save_url": data.get("googleSaveUrl"),
        "apple_pass": data.get("applePass"),
    }


def update_pass() -> dict[str, Any] | None:
    state = get_pass_state()
    serial = state.get("serial_number")
    if not serial or not configured():
        return None

    with httpx.Client(timeout=30.0) as client:
        res = client.put(
            f"{BASE_URL}/api/passes/{serial}",
            headers=_headers(),
            json=build_pass_body(),
        )
        if res.status_code >= 400:
            raise RuntimeError(f"WalletWallet update failed ({res.status_code}): {res.text}")
        data = res.json()

    set_pass_state(
        {
            "serial_number": data.get("serialNumber") or serial,
            "share_url": data.get("shareUrl") or state.get("share_url"),
            "google_save_url": data.get("googleSaveUrl") or state.get("google_save_url"),
        }
    )
    return {
        "serial_number": data.get("serialNumber") or serial,
        "share_url": data.get("shareUrl") or state.get("share_url"),
        "updated": True,
    }
