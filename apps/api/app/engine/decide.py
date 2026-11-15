"""Formal Decision Engine scoring API.

`decide()` is the single entry point for authorization-time routing:

- Resolves category (MCC + merchant overrides)
- Scores every linked card under constraints (caps, APR, denylist)
- Returns a stable ranked list and a deterministic winner reason

Reason strings are stable templates (no timestamps, no locale drift).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Iterable, Mapping, Optional, Sequence

from app.engine.merchant_intel import resolve_category
from app.engine.score import (
    _baseline_cents,
    _bonus_rate,
    _effective_apr,
    _money,
    _spent_for,
    score_card,
)


@dataclass(frozen=True)
class Constraints:
    """Hard and soft constraints applied while ranking cards."""

    caps: Mapping[str, Mapping[str, int]] = field(default_factory=dict)
    denylist: frozenset[str] = field(default_factory=frozenset)
    max_apr: Optional[float] = None
    carry_months: float = 0.0
    today: Optional[date] = None

    @staticmethod
    def from_parts(
        caps: Optional[Mapping[str, Mapping[str, int]]] = None,
        denylist: Optional[Iterable[str]] = None,
        max_apr: Optional[float] = None,
        carry_months: float = 0.0,
        today: Optional[date] = None,
    ) -> "Constraints":
        return Constraints(
            caps=caps or {},
            denylist=frozenset(denylist or ()),
            max_apr=max_apr,
            carry_months=float(carry_months or 0.0),
            today=today,
        )


def decide(
    cards: Sequence[dict[str, Any]],
    amount_cents: int,
    *,
    mcc: str = "",
    merchant_name: str = "",
    category: Optional[str] = None,
    constraints: Optional[Constraints] = None,
    mcc_map: Optional[dict] = None,
    overrides: Optional[list] = None,
) -> dict[str, Any]:
    """Rank linked cards and pick the best eligible one.

    Returns a decision dict:
      card_id, name, reward_cents, value_cents, baseline_value_cents,
      savings_cents, reason, ranking, category, category_confidence,
      category_source, mcc, constraints_applied
    """
    amount_cents = int(amount_cents)
    if amount_cents < 0:
        raise ValueError("amount_cents must be >= 0")

    constraints = constraints or Constraints()
    today = constraints.today or date.today()
    carry = float(constraints.carry_months or 0.0)

    intel = None
    if category is None:
        intel = resolve_category(
            mcc or "",
            merchant_name,
            mcc_map=mcc_map,
            overrides=overrides,
        )
        category = intel["category"]
    else:
        intel = {
            "category": category,
            "confidence": 1.0,
            "source": "provided",
            "override_id": None,
            "mcc_category": category,
        }

    ranking: list[dict[str, Any]] = []
    for card in cards:
        if not card.get("in_wallet", True):
            continue
        row = _score_under_constraints(card, category, amount_cents, constraints, today, carry)
        ranking.append(row)

    if not ranking:
        raise ValueError("no in-wallet cards")

    eligible = [row for row in ranking if row["eligible"]]
    if not eligible:
        raise ValueError("no eligible cards after constraints")

    rank_key = _rank_key(carry)
    eligible.sort(key=rank_key)
    blocked = sorted(
        [row for row in ranking if not row["eligible"]],
        key=lambda r: r["card_id"],
    )
    ordered = eligible + blocked
    for index, row in enumerate(ordered, start=1):
        row["rank"] = index

    winner = eligible[0]
    baseline = _baseline_cents(amount_cents)
    reason = stable_winner_reason(winner["reason"], baseline)

    return {
        "card_id": winner["card_id"],
        "name": winner["name"],
        "value_cents": winner["value_cents"],
        "reward_cents": winner["reward_cents"],
        "apr_cost_cents": winner["apr_cost_cents"],
        "baseline_value_cents": baseline,
        "savings_cents": winner["reward_cents"] - baseline,
        "reason": reason,
        "ranking": ordered,
        "mcc": str(mcc) if mcc else None,
        "category": category,
        "category_confidence": float(intel["confidence"]),
        "category_source": intel["source"],
        "override_id": intel.get("override_id"),
        "constraints_applied": {
            "denylist": sorted(constraints.denylist),
            "max_apr": constraints.max_apr,
            "carry_months": carry,
            "caps": {cid: dict(buckets) for cid, buckets in constraints.caps.items()},
        },
    }


def stable_winner_reason(card_reason: str, baseline_cents: float) -> str:
    """Winner reason: card template + fixed baseline comparison."""
    return f"{card_reason} (vs {_money(baseline_cents)} at 1%)"


def stable_blocked_reason(kind: str) -> str:
    if kind == "denylist":
        return "blocked:denylist"
    if kind == "apr":
        return "blocked:apr"
    if kind == "unlinked":
        return "blocked:unlinked"
    return f"blocked:{kind}"


def _score_under_constraints(card, category, amount_cents, constraints, today, carry) -> dict:
    card_id = card["id"]
    spent = _spent_for(card, category, dict(constraints.caps.get(card_id) or {}))
    scored = score_card(
        card,
        category,
        amount_cents,
        cap_spent_cents=spent,
        carry_months=carry,
        today=today,
    )

    blocked_by = None
    if card_id in constraints.denylist:
        blocked_by = "denylist"
    else:
        apr = _effective_apr(card, today)
        if constraints.max_apr is not None and apr > float(constraints.max_apr):
            # Active 0% promo already zeroes effective APR.
            blocked_by = "apr"

    if blocked_by:
        scored["eligible"] = False
        scored["constraint"] = blocked_by
        scored["reason"] = stable_blocked_reason(blocked_by)
        scored["value_cents"] = float("-inf")
    else:
        scored["eligible"] = True
        scored["constraint"] = None
        # Everyday: value == reward. Finance: value == reward − APR cost (already in score_card).
        if carry <= 0:
            scored["value_cents"] = scored["reward_cents"]

    scored["bonus_key"] = _bonus_rate(card, category)[0]
    return scored


def _rank_key(carry: float):
    # Higher value first; ties → lower card_id for determinism.
    if carry > 0:
        return lambda row: (-row["value_cents"], row["card_id"])
    return lambda row: (-row["reward_cents"], row["card_id"])
