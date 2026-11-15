"""MCC + merchant_overrides resolution."""

import unittest

from app.engine.decide import Constraints, decide
from app.engine.merchant_intel import resolve_category
from app.engine.score import load_cards, load_merchants, select_card


class MerchantIntelTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cards = load_cards()
        cls.merchants = {m["id"]: m for m in load_merchants()}

    def test_plain_grocery_mcc_stays_groceries(self):
        hit = resolve_category("5411", "Whole Foods")
        self.assertEqual(hit["category"], "groceries")
        self.assertEqual(hit["source"], "mcc")
        self.assertGreaterEqual(hit["confidence"], 0.8)

    def test_coffee_in_grocery_override(self):
        hit = resolve_category("5411", "Starbucks at Whole Foods")
        self.assertEqual(hit["category"], "dining")
        self.assertEqual(hit["source"], "override")
        self.assertEqual(hit["override_id"], "coffee_counter_in_grocery")
        self.assertEqual(hit["mcc_category"], "groceries")
        self.assertGreaterEqual(hit["confidence"], 0.9)

    def test_coffee_in_grocery_routes_to_amex_gold(self):
        merchant = self.merchants["coffee_in_grocery"]
        # MCC alone would pick Freedom Flex (grocery rotating 5x).
        by_mcc = select_card(self.cards, merchant["amount_cents"], merchant["mcc"])
        self.assertEqual(by_mcc["category"], "groceries")
        self.assertEqual(by_mcc["card_id"], "freedom_flex")

        # Name override → dining → Amex Gold 4x.
        decided = select_card(
            self.cards,
            merchant["amount_cents"],
            merchant["mcc"],
            merchant_name=merchant["name"],
        )
        self.assertEqual(decided["category"], "dining")
        self.assertEqual(decided["category_source"], "override")
        self.assertEqual(decided["card_id"], "amex_gold")
        self.assertAlmostEqual(decided["reward_cents"], 26.0)  # $6.50 × 4x

    def test_pharmacy_inside_target_override(self):
        hit = resolve_category("5311", "CVS Pharmacy at Target")
        self.assertEqual(hit["category"], "drugstore")
        self.assertEqual(hit["source"], "override")

    def test_unknown_mcc_defaults_other(self):
        hit = resolve_category("9999", "Mystery Merchant")
        self.assertEqual(hit["category"], "other")
        self.assertEqual(hit["source"], "default")


class ConstraintsApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cards = load_cards()

    def test_denylist_skips_blocked_card(self):
        result = decide(
            self.cards,
            600,
            mcc="5814",
            merchant_name="Blue Bottle Coffee",
            constraints=Constraints.from_parts(denylist=["amex_gold"]),
        )
        self.assertNotEqual(result["card_id"], "amex_gold")
        blocked = next(r for r in result["ranking"] if r["card_id"] == "amex_gold")
        self.assertFalse(blocked["eligible"])
        self.assertEqual(blocked["reason"], "blocked:denylist")
        self.assertEqual(blocked["constraint"], "denylist")
        # Next-best dining: Sapphire 3x × 1.25¢
        self.assertEqual(result["card_id"], "sapphire_pref")

    def test_max_apr_blocks_high_apr_cards(self):
        result = decide(
            self.cards,
            129900,
            category="other",
            constraints=Constraints.from_parts(max_apr=0.01),
        )
        # Only Reflect has effective 0% via promo.
        self.assertEqual(result["card_id"], "reflect")
        for row in result["ranking"]:
            if row["card_id"] == "reflect":
                self.assertTrue(row["eligible"])
            else:
                self.assertFalse(row["eligible"])
                self.assertEqual(row["reason"], "blocked:apr")

    def test_ranked_scores_are_dense_and_stable(self):
        a = decide(self.cards, 600, mcc="5814", merchant_name="Blue Bottle Coffee")
        b = decide(self.cards, 600, mcc="5814", merchant_name="Blue Bottle Coffee")
        self.assertEqual([r["card_id"] for r in a["ranking"]], [r["card_id"] for r in b["ranking"]])
        self.assertEqual(a["reason"], b["reason"])
        self.assertEqual([r["rank"] for r in a["ranking"]], list(range(1, len(a["ranking"]) + 1)))
        self.assertIn("(vs $0.06 at 1%)", a["reason"])


if __name__ == "__main__":
    unittest.main()
