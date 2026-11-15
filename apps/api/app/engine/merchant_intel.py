"""Merchant category resolution with overrides on top of MCC.

Authorization MCCs are coarse. A Starbucks inside Whole Foods often
rings as grocery (5411). Overrides match merchant name (+ optional MCC)
and return a category with a confidence score.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

from app.engine.score import RULES_DIR, category_for_mcc, load_mcc_map

MCC_CONFIDENCE = 0.8
DEFAULT_CONFIDENCE = 0.5


def load_overrides(path: Optional[Path] = None) -> list[dict[str, Any]]:
    target = path or RULES_DIR / "merchant_overrides.json"
    with target.open() as handle:
        return json.load(handle)


def resolve_category(
    mcc: str,
    merchant_name: str = "",
    *,
    mcc_map: Optional[dict] = None,
    overrides: Optional[list] = None,
) -> dict[str, Any]:
    """Return `{category, confidence, source, override_id}` for one auth."""
    mcc = str(mcc)
    mcc_map = load_mcc_map() if mcc_map is None else mcc_map
    overrides = load_overrides() if overrides is None else overrides

    hit = _match_override(merchant_name, mcc, overrides)
    if hit is not None:
        return {
            "category": hit["category"],
            "confidence": float(hit.get("confidence", 0.9)),
            "source": "override",
            "override_id": hit.get("id"),
            "mcc_category": category_for_mcc(mcc, mcc_map),
        }

    mapped = category_for_mcc(mcc, mcc_map)
    if mapped != "other":
        return {
            "category": mapped,
            "confidence": MCC_CONFIDENCE,
            "source": "mcc",
            "override_id": None,
            "mcc_category": mapped,
        }
    return {
        "category": "other",
        "confidence": DEFAULT_CONFIDENCE,
        "source": "default",
        "override_id": None,
        "mcc_category": "other",
    }


def _match_override(merchant_name: str, mcc: str, overrides: list) -> Optional[dict]:
    name = (merchant_name or "").casefold()
    for rule in overrides:
        match = rule.get("match") or {}
        needles = match.get("name_contains") or []
        if isinstance(needles, str):
            needles = [needles]
        mccs = match.get("mcc_in")
        if mccs is not None and str(mcc) not in {str(x) for x in mccs}:
            continue
        if needles and not any(str(n).casefold() in name for n in needles):
            continue
        if not needles and mccs is None:
            continue
        return rule
    return None
