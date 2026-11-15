from fastapi import APIRouter

from app.schemas import CardOut
from app.services.rules import load_cards
from app.store import get_spend

router = APIRouter(prefix="/cards", tags=["cards"])


def _highlight(card: dict) -> str:
    rates = card.get("rates") or {}
    parts: list[str] = []
    rotating = card.get("rotating_categories") or []
    if rotating and "rotating" in rates:
        parts.append(f"{rates['rotating']:g}x rotating ({', '.join(rotating)})")
    for key, rate in rates.items():
        if key in {"default", "rotating"}:
            continue
        parts.append(f"{rate:g}x {key}")
    if "default" in rates:
        parts.append(f"{rates['default']:g}x default")
    return " · ".join(parts[:3]) or "rewards"


@router.get("", response_model=list[CardOut])
def list_cards() -> list[CardOut]:
    spend = get_spend()
    cards = [c for c in load_cards() if c.get("in_wallet", True)]
    default_id = next((c["id"] for c in cards if c.get("is_default")), cards[0]["id"] if cards else "")
    return [
        CardOut(
            id=c["id"],
            name=c["name"],
            issuer=c.get("issuer") or "",
            last4=c.get("last4") or "0000",
            is_default=c["id"] == default_id,
            highlight=_highlight(c),
            category_spend=float(spend.get(c["id"], 0.0)),
            intro_apr_ends_on=c.get("apr_promo_end") or c.get("intro_apr_ends_on"),
        )
        for c in cards
    ]
