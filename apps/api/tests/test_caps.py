"""Period-aware bonus-spend tracking."""

import unittest
from datetime import date

from app.engine.caps import (
    apply_purchase,
    caps_for_scoring,
    period_bounds,
    period_id,
)
from app.engine.score import choose_card, load_cards, select_card

TODAY = date(2026, 11, 15)  # Q4 2026


class CapPeriodsTest(unittest.TestCase):
    def test_quarter_and_year_ids(self):
        self.assertEqual(period_id("quarter", date(2026, 1, 1)), "2026-Q1")
        self.assertEqual(period_id("quarter", date(2026, 4, 1)), "2026-Q2")
        self.assertEqual(period_id("quarter", TODAY), "2026-Q4")
        self.assertEqual(period_id("calendar_year", TODAY), "2026")
        self.assertEqual(period_id("month", TODAY), "2026-11")

    def test_quarter_bounds(self):
        start, end = period_bounds("quarter", TODAY)
        self.assertEqual(start, date(2026, 10, 1))
        self.assertEqual(end, date(2027, 1, 1))
        start, end = period_bounds("calendar_year", TODAY)
        self.assertEqual(start, date(2026, 1, 1))
        self.assertEqual(end, date(2027, 1, 1))


class CapTrackerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cards = load_cards()
        cls.flex = next(c for c in cls.cards if c["id"] == "freedom_flex")
        cls.gold = next(c for c in cls.cards if c["id"] == "amex_gold")

    def test_gas_credits_rotating_bucket_only(self):
        ledger: dict[str, int] = {}
        applied = apply_purchase(ledger, self.flex, "gas", 4500, today=TODAY)
        self.assertEqual(applied["cap_key"], "rotating")
        self.assertEqual(applied["credited_cents"], 4500)
        self.assertEqual(applied["period_id"], "2026-Q4")
        self.assertEqual(applied["spent_cents"], 4500)
        self.assertEqual(applied["remaining_cents"], 145500)

        caps = caps_for_scoring(self.cards, ledger, today=TODAY)
        self.assertEqual(caps["freedom_flex"]["rotating"], 4500)

    def test_dining_on_flex_does_not_touch_rotating_cap(self):
        ledger: dict[str, int] = {}
        applied = apply_purchase(ledger, self.flex, "dining", 4800, today=TODAY)
        self.assertIsNone(applied["cap_key"])
        self.assertEqual(applied["credited_cents"], 0)
        self.assertEqual(ledger, {})

    def test_only_bonus_portion_counts_toward_cap(self):
        ledger = {"freedom_flex|rotating|2026-Q4": 149000}
        applied = apply_purchase(ledger, self.flex, "gas", 4500, today=TODAY)
        self.assertEqual(applied["credited_cents"], 1000)
        self.assertEqual(ledger["freedom_flex|rotating|2026-Q4"], 150000)
        self.assertEqual(applied["remaining_cents"], 0)

    def test_prior_quarter_spend_does_not_block_current_quarter(self):
        ledger = {"freedom_flex|rotating|2026-Q3": 150000}
        caps = caps_for_scoring(self.cards, ledger, today=TODAY)
        self.assertEqual(caps["freedom_flex"]["rotating"], 0)

        result = select_card(
            self.cards,
            4500,
            "5542",
            caps=caps,
            today=TODAY,
        )
        self.assertEqual(result["card_id"], "freedom_flex")
        self.assertAlmostEqual(result["reward_cents"], 225.0)

    def test_year_boundary_resets_amex_grocery_cap(self):
        ledger = {"amex_gold|groceries|2025": 2500000}
        caps = caps_for_scoring(self.cards, ledger, today=TODAY)
        self.assertEqual(caps["amex_gold"]["groceries"], 0)

        # Flex rotating already full this quarter → Gold should win groceries.
        caps["freedom_flex"] = {"rotating": 150000}
        result = choose_card(self.cards, "groceries", 8400, caps=caps, today=TODAY)
        self.assertEqual(result["card_id"], "amex_gold")
        self.assertAlmostEqual(result["reward_cents"], 336.0)

    def test_sequence_fills_rotating_then_yields_to_gold(self):
        ledger: dict[str, int] = {}
        # Burn the $1,500 rotating bucket with gas this quarter.
        apply_purchase(ledger, self.flex, "gas", 150000, today=TODAY)
        caps = caps_for_scoring(self.cards, ledger, today=TODAY)
        self.assertEqual(caps["freedom_flex"]["rotating"], 150000)

        grocery = select_card(self.cards, 8400, "5411", caps=caps, today=TODAY)
        self.assertEqual(grocery["card_id"], "amex_gold")

        applied = apply_purchase(ledger, self.gold, "groceries", 8400, today=TODAY)
        self.assertEqual(applied["cap_key"], "groceries")
        self.assertEqual(applied["period_id"], "2026")
        self.assertEqual(applied["credited_cents"], 8400)

        caps = caps_for_scoring(self.cards, ledger, today=TODAY)
        self.assertEqual(caps["amex_gold"]["groceries"], 8400)
        self.assertEqual(caps["freedom_flex"]["rotating"], 150000)


if __name__ == "__main__":
    unittest.main()
