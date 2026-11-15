"""WalletWallet pass create/update for the Juno card in Apple/Google Wallet."""

from __future__ import annotations

import os
import re
from typing import Any

import httpx

from app.store import get_pass_state, list_transactions, set_pass_state

BASE_URL = "https://api.walletwallet.dev"
_PASS_ID_RE = re.compile(r"/p/([0-9a-fA-F-]{36})")


def configured() -> bool:
    return bool(os.getenv("WALLETWALLET_API_KEY", "").strip())


def _env_apple_url() -> str:
    return os.getenv("WALLETWALLET_APPLE_PASS_URL", "").strip()


def _env_google_url() -> str:
    return os.getenv("WALLETWALLET_GOOGLE_PASS_URL", "").strip()


def _serial_from_url(url: str) -> str | None:
    match = _PASS_ID_RE.search(url or "")
    return match.group(1) if match else None


def ensure_pass_links() -> dict[str, Any]:
    """Seed Apple/Google share links from env when the DB row is empty or stale."""
    state = get_pass_state()
    apple = _env_apple_url()
    google = _env_google_url()
    if not apple and not google:
        return state

    serial = (
        state.get("serial_number")
        or _serial_from_url(apple)
        or _serial_from_url(google)
    )
    next_state = {
        "serial_number": serial,
        "share_url": apple or state.get("share_url"),
        "google_save_url": google or state.get("google_save_url"),
        "apple_pass_path": state.get("apple_pass_path"),
    }
    if (
        next_state.get("serial_number") == state.get("serial_number")
        and next_state.get("share_url") == state.get("share_url")
        and next_state.get("google_save_url") == state.get("google_save_url")
    ):
        return state
    return set_pass_state(next_state)


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
        notification = f"Routed to {routed} · +{extra} vs 1%"
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

    apple = _env_apple_url()
    google = _env_google_url()
    set_pass_state(
        {
            "serial_number": (
                _serial_from_url(apple)
                or data.get("serialNumber")
            ),
            "share_url": apple or data.get("shareUrl"),
            "google_save_url": google or data.get("googleSaveUrl"),
        }
    )
    state = ensure_pass_links()
    return {
        "serial_number": state.get("serial_number") or data.get("serialNumber"),
        "share_url": state.get("share_url") or data.get("shareUrl"),
        "google_save_url": state.get("google_save_url") or data.get("googleSaveUrl"),
        "apple_pass": data.get("applePass"),
    }


def update_pass() -> dict[str, Any] | None:
    state = ensure_pass_links()
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

    apple = _env_apple_url()
    google = _env_google_url()
    set_pass_state(
        {
            "serial_number": data.get("serialNumber") or serial,
            "share_url": apple or data.get("shareUrl") or state.get("share_url"),
            "google_save_url": google
            or data.get("googleSaveUrl")
            or state.get("google_save_url"),
        }
    )
    return {
        "serial_number": data.get("serialNumber") or serial,
        "share_url": apple or data.get("shareUrl") or state.get("share_url"),
        "updated": True,
    }
