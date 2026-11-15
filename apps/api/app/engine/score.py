"""Pick the linked card that pays the most cash back on one purchase.

The wallet holds a single Juno card. At authorization time that card
does not earn rewards itself: it chooses among the linked cards.

Cash back, in cents:

    amount_dollars × rate × point_value_cents

Rates are points or percent-back per dollar. A cap is the max bonus
spend in cents; dollars past the remaining cap earn the default rate.
The winner is the linked card with the highest cash back. Ties break
to the lower card id.

APR cost is reported on a single-card score when `carry_months` is set.
It never changes which card is selected.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Optional

RULES_DIR = Path(__file__).resolve().parents[4] / "packages" / "card-rules"


def load_cards(path: Optional[Path] = None) -> list:
    return _load(path or RULES_DIR / "cards.json")


def load_merchants(path: Optional[Path] = None) -> list:
    return _load(path or RULES_DIR / "merchants.json")


def load_mcc_map(path: Optional[Path] = None) -> dict:
    return _load(path or RULES_DIR / "mcc.json")


def merchant_by_id(merchants: list, merchant_id: str) -> dict:
    for merchant in merchants:
        if merchant["id"] == merchant_id:
            return merchant
    raise KeyError(merchant_id)


def score_card(
    card: dict,
    category: str,
    amount_cents: int,
    cap_spent_cents: int = 0,
    carry_months: float = 0,
    today: Optional[date] = None,
) -> dict:
    """Score one card. `cap_spent_cents` is bonus spend already used this period."""
    today = today or date.today()
    amount_cents = int(amount_cents)
    if amount_cents < 0:
        raise ValueError("amount_cents must be >= 0")

    bonus_key, bonus_rate = _bonus_rate(card, category)
    default_rate = float(card["rates"]["default"])
    cap = (card.get("caps") or {}).get(bonus_key)
    bonus_cents, default_cents = _split_cap(
        amount_cents, cap, cap_spent_cents, bonus_rate, default_rate
    )

    point_value = float(card["point_value_cents"])
    reward = _reward_cents(bonus_cents, bonus_rate, point_value) + _reward_cents(
        default_cents, default_rate, point_value
    )

    apr = _effective_apr(card, today)
    apr_cost = amount_cents * apr * (float(carry_months) / 12.0)
    promo_end = _promo_end(card, today)

    value = reward - apr_cost
    return {
        "card_id": card["id"],
        "name": card.get("name", card["id"]),
        "value_cents": value,
        "reward_cents": reward,
        "apr_cost_cents": apr_cost,
        "rate": bonus_rate if bonus_cents else default_rate,
        "bonus_cents": bonus_cents,
        "default_cents": default_cents,
        "promo_end": promo_end,
        "reason": _score_reason(
            card,
            category,
            bonus_key,
            bonus_rate,
            default_rate,
            bonus_cents,
            default_cents,
            reward,
            apr_cost,
            promo_end,
            carry_months,
        ),
        "eligible": card.get("in_wallet", True),
    }


def category_for_mcc(mcc: str, mcc_map: Optional[dict] = None) -> str:
    """Map a merchant category code to a reward category. Unknown codes are `other`."""
    mcc_map = load_mcc_map() if mcc_map is None else mcc_map
    return mcc_map.get(str(mcc), "other")


def select_card(
    cards: list,
    amount_cents: int,
    mcc: str,
    caps: Optional[dict] = None,
    today: Optional[date] = None,
    mcc_map: Optional[dict] = None,
) -> dict:
    """Route one wallet tap. `mcc` is what the authorization carries."""
    category = category_for_mcc(mcc, mcc_map)
    result = choose_card(cards, category, amount_cents, caps=caps, today=today)
    result["mcc"] = str(mcc)
    result["category"] = category
    return result


def choose_card(
    cards: list,
    category: str,
    amount_cents: int,
    caps: Optional[dict] = None,
    today: Optional[date] = None,
) -> dict:
    """Pick the linked card with the highest cash back.

    Cards with `in_wallet: false` are not linked and are skipped.
    `caps` is `{card_id: {cap_key: spent_cents}}` for the current period.
    A rotating cap is one bucket: gas and groceries share it on Freedom Flex.
    """
    today = today or date.today()
    caps = caps or {}

    ranking = []
    for card in cards:
        if not card.get("in_wallet", True):
            continue
        spent = _spent_for(card, category, caps.get(card["id"]) or {})
        ranking.append(
            score_card(
                card,
                category,
                amount_cents,
                cap_spent_cents=spent,
                carry_months=0,
                today=today,
            )
        )
    if not ranking:
        raise ValueError("no in-wallet cards")

    ranking.sort(key=lambda row: (-row["reward_cents"], row["card_id"]))
    winner = ranking[0]
    baseline = _baseline_cents(amount_cents)
    reason = f"{winner['reason']} (vs {_money(baseline)} at 1%)"
    return {
        "card_id": winner["card_id"],
        "name": winner["name"],
        "value_cents": winner["reward_cents"],
        "reward_cents": winner["reward_cents"],
        "apr_cost_cents": 0.0,
        "baseline_value_cents": baseline,
        "savings_cents": winner["reward_cents"] - baseline,
        "reason": reason,
        "ranking": ranking,
    }


def _load(path: Path) -> list:
    with path.open() as handle:
        return json.load(handle)


def _bonus_rate(card: dict, category: str) -> tuple:
    rates = card["rates"]
    rotating = card.get("rotating_categories") or []
    if category in rotating and "rotating" in rates:
        return "rotating", float(rates["rotating"])
    if category in rates:
        return category, float(rates[category])
    return "default", float(rates["default"])


def _split_cap(amount_cents, cap, spent_cents, bonus_rate, default_rate):
    if cap is None or bonus_rate == default_rate:
        return amount_cents, 0
    remaining = max(0, int(cap) - int(spent_cents))
    bonus_cents = min(amount_cents, remaining)
    return bonus_cents, amount_cents - bonus_cents


def _reward_cents(amount_cents: int, rate: float, point_value_cents: float) -> float:
    return (amount_cents / 100.0) * rate * point_value_cents


def _effective_apr(card: dict, today: date) -> float:
    if _promo_end(card, today) is not None:
        return 0.0
    return float(card.get("apr") or 0.0)


def _promo_end(card: dict, today: date) -> Optional[date]:
    raw = card.get("apr_promo_end")
    if not raw:
        return None
    end = date.fromisoformat(raw)
    if today <= end:
        return end
    return None


def _spent_for(card: dict, category: str, card_caps: dict) -> int:
    key, _rate = _bonus_rate(card, category)
    if key in card_caps:
        return int(card_caps[key])
    return int(card_caps.get(category, 0))


def _baseline_cents(amount_cents: int) -> float:
    return _reward_cents(amount_cents, 1.0, 1.0)


def _score_reason(
    card,
    category,
    bonus_key,
    bonus_rate,
    default_rate,
    bonus_cents,
    default_cents,
    reward,
    apr_cost,
    promo_end,
    carry_months,
) -> str:
    if promo_end is not None and carry_months and float(card["rates"].get("default", 0)) == 0 and reward == 0:
        return f"0% APR until {promo_end.strftime('%b %Y')}"

    if default_cents and bonus_cents:
        text = (
            f"{_rate(bonus_rate)} {_portion(bonus_key, category, bonus_cents)}, "
            f"{_rate(default_rate)} on {_money(default_cents)} → {_money(reward)}"
        )
    else:
        rate = bonus_rate if bonus_cents else default_rate
        key = bonus_key if bonus_cents else "default"
        text = f"{_rate(rate)} {_rate_label(key, category)} → {_money(reward)}"

    if apr_cost:
        text += f" − {_money(apr_cost)} interest"
    elif promo_end is not None and carry_months:
        text += f", 0% APR until {promo_end.strftime('%b %Y')}"
    return text


def _rate_label(rate_key: str, category: str) -> str:
    if rate_key == "rotating":
        return f"rotating on {category}"
    if rate_key == "default":
        return "everywhere"
    return f"on {category}"


def _portion(rate_key: str, category: str, amount_cents: int) -> str:
    amount = _money(amount_cents)
    if rate_key == "rotating":
        return f"rotating on {amount} of {category}"
    if rate_key == "default":
        return f"on {amount}"
    return f"on {amount} of {category}"


def _rate(rate: float) -> str:
    return f"{rate:g}x"


def _money(cents: float) -> str:
    sign = "-" if cents < 0 else ""
    return f"{sign}${abs(cents) / 100:.2f}"
