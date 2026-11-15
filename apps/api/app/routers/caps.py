"""Cap status for UI meters — no scoring side effects."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter

from app.schemas import CapBucketOut, CapStatusResponse
from app.services.rules import load_cards
from app.store import get_cap_status

router = APIRouter(tags=["caps"])


@router.get("/caps", response_model=CapStatusResponse)
def list_caps() -> CapStatusResponse:
    """Return current-period bonus caps for every linked card.

    Example:
      {
        "as_of": "2026-11-15",
        "caps": {
          "freedom_flex": {
            "rotating": {"spent": 0, "limit": 1500, "remaining": 1500, "period": "quarter", ...}
          },
          "amex_gold": {
            "groceries": {"spent": 0, "limit": 25000, "remaining": 25000, "period": "calendar_year", ...}
          }
        }
      }
    """
    cards = [c for c in load_cards() if c.get("in_wallet", True)]
    today = date.today()
    raw = get_cap_status(cards, today=today)
    caps = {
        card_id: {
            key: CapBucketOut(**bucket) for key, bucket in buckets.items()
        }
        for card_id, buckets in raw.items()
    }
    return CapStatusResponse(as_of=today.isoformat(), caps=caps)
