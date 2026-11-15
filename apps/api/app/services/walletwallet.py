"""WalletWallet pass create/update for the Juno card in Apple/Google Wallet."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

import httpx
from dotenv import dotenv_values

from app.store import get_pass_state, list_transactions, set_pass_state

BASE_URL = "https://api.walletwallet.dev"
_PASS_ID_RE = re.compile(r"/p/([0-9a-fA-F-]{36})")


def _root_env_path() -> Path:
    """Walk up from this file to the repo-root .env (not apps/ or apps/api/)."""
    here = Path(__file__).resolve().parent
    for directory in (here, *here.parents):
        candidate = directory / ".env"
        if candidate.is_file():
            return candidate
    return Path.cwd() / ".env"


def configured() -> bool:
    return bool(_wallet_env("WALLETWALLET_API_KEY"))


def _wallet_env(name: str) -> str:
    """Prefer repo .env over process env so link edits apply without a full shell re-source."""
    env_path = _root_env_path()
    if env_path.is_file():
        file_vals = dotenv_values(env_path)
        if name in file_vals and file_vals[name] is not None:
            return str(file_vals[name]).strip()
    return os.getenv(name, "").strip()


def _env_apple_url() -> str:
    return _wallet_env("WALLETWALLET_APPLE_PASS_URL")


def _env_google_url() -> str:
    return _wallet_env("WALLETWALLET_GOOGLE_PASS_URL")


def _serial_from_url(url: str) -> str | None:
    match = _PASS_ID_RE.search(url or "")
    return match.group(1) if match else None


def ensure_pass_links() -> dict[str, Any]:
    """Seed Apple/Google share links from env when the DB row is empty or stale.

    Fixed env URLs win over whatever serial/share_url is already in the DB — otherwise
    an old serial survives a .env update and every update_pass() writes the old link back.
    """
    state = get_pass_state()
    apple = _env_apple_url()
    google = _env_google_url()
    if not apple and not google:
        return state

    serial = (
        _serial_from_url(apple)
        or _serial_from_url(google)
        or state.get("serial_number")
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
    key = _wallet_env("WALLETWALLET_API_KEY")
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
    """Create a WalletWallet pass, or refresh the fixed env-linked pass if configured.

    When WALLETWALLET_*_PASS_URL is set, minting a new pass is pointless — ensure_pass_links
    would immediately overwrite the new share URL with the env link. Sync that pass instead.
    """
    apple = _env_apple_url()
    google = _env_google_url()
    if apple or google:
        ensure_pass_links()
        updated = update_pass()
        state = get_pass_state()
        if updated or state.get("share_url") or state.get("google_save_url"):
            return {
                "serial_number": state.get("serial_number"),
                "share_url": state.get("share_url"),
                "google_save_url": state.get("google_save_url"),
                "apple_pass": None,
            }

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
    state = ensure_pass_links()
    return {
        "serial_number": state.get("serial_number") or data.get("serialNumber"),
        "share_url": state.get("share_url") or data.get("shareUrl"),
        "google_save_url": state.get("google_save_url") or data.get("googleSaveUrl"),
        "apple_pass": data.get("applePass"),
    }


def update_pass() -> dict[str, Any] | None:
    state = ensure_pass_links()
    apple = _env_apple_url()
    google = _env_google_url()
    serial = (
        _serial_from_url(apple)
        or state.get("serial_number")
        or _serial_from_url(google)
    )
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

    # Env fixed links always win; never let the API response resurrect a stale share URL.
    next_serial = _serial_from_url(apple) or data.get("serialNumber") or serial
    set_pass_state(
        {
            "serial_number": next_serial,
            "share_url": apple or data.get("shareUrl") or state.get("share_url"),
            "google_save_url": google
            or data.get("googleSaveUrl")
            or state.get("google_save_url"),
        }
    )
    return {
        "serial_number": next_serial,
        "share_url": apple or data.get("shareUrl") or state.get("share_url"),
        "updated": True,
    }
