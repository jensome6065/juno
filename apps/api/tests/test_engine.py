"""Hard-coded purchases against the demo card rules. No Stripe."""

import unittest
from datetime import date

from app.engine.score import (
    choose_card,
    load_cards,
    load_mcc_map,
    load_merchants,
    merchant_by_id,
    score_card,
    select_card,
)

TODAY = date(2026, 11, 15)


class ScorePurchasesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cards = load_cards()
        cls.merchants = {m["id"]: m for m in load_merchants()}

    def test_library_has_six_cards_and_demo_merchants(self):
        self.assertEqual(
            {c["id"] for c in self.cards},
            {
                "amex_gold",
                "freedom_flex",
                "double_cash",
                "sapphire_pref",
                "freedom_unlimited",
                "reflect",
            },
        )
        self.assertGreaterEqual(len(self.merchants), 10)
        self.assertEqual(self.merchants["coffee"]["mcc"], "5814")
        self.assertEqual(self.merchants["grocery"]["mcc"], "5411")
        self.assertEqual(self.merchants["gas"]["mcc"], "5542")
        self.assertEqual(self.merchants["electronics"]["mcc"], "5732")

    def test_coffee_picks_amex_gold(self):
        result = self._choose("coffee")
        self.assertEqual(result["card_id"], "amex_gold")
        self.assertAlmostEqual(result["value_cents"], 24.0)  # $6 × 4x × 1¢
        self.assertAlmostEqual(result["baseline_value_cents"], 6.0)
        self.assertIn("4x on dining", result["reason"])
        self.assertIn("$0.24", result["reason"])
        self.assertIn("$0.06", result["reason"])

    def test_grocery_picks_freedom_flex_rotating(self):
        result = self._choose("grocery")
        self.assertEqual(result["card_id"], "freedom_flex")
        # $84 × 5x rotating
        self.assertAlmostEqual(result["value_cents"], 420.0)
        self.assertIn("5x rotating on groceries", result["reason"])

    def test_gas_picks_freedom_flex_rotating(self):
        result = self._choose("gas")
        self.assertEqual(result["card_id"], "freedom_flex")
        self.assertAlmostEqual(result["value_cents"], 225.0)  # $45 × 5x
        self.assertIn("5x rotating on gas", result["reason"])

    def test_gas_past_rotating_cap_falls_back_to_double_cash(self):
        gas = self.merchants["gas"]
        result = choose_card(
            self.cards,
            gas["category"],
            gas["amount_cents"],
            caps={"freedom_flex": {"rotating": 150000}},
            today=TODAY,
        )
        self.assertEqual(result["card_id"], "double_cash")
        self.assertAlmostEqual(result["value_cents"], 90.0)  # $45 × 2%
        flex = next(row for row in result["ranking"] if row["card_id"] == "freedom_flex")
        self.assertAlmostEqual(flex["reward_cents"], 45.0)  # default 1x past the cap

    def test_tap_uses_mcc_and_picks_max_cash_back(self):
        coffee = select_card(self.cards, 600, "5814", today=TODAY)
        grocery = select_card(self.cards, 8400, "5411", today=TODAY)
        gas = select_card(self.cards, 4500, "5542", today=TODAY)
        self.assertEqual(coffee["card_id"], "amex_gold")
        self.assertEqual(coffee["category"], "dining")
        self.assertEqual(grocery["card_id"], "freedom_flex")
        self.assertEqual(gas["card_id"], "freedom_flex")
        unknown = select_card(self.cards, 2000, "5732", today=TODAY)
        self.assertEqual(unknown["category"], "other")
        self.assertEqual(unknown["card_id"], "double_cash")

    def test_rotating_cap_is_shared_by_gas_and_groceries(self):
        # The $1,500 Freedom Flex bucket is already full from gas.
        # Grocery cash back then falls to Amex Gold at 4x, ahead of Double Cash at 2%.
        result = choose_card(
            self.cards,
            "groceries",
            8400,
            caps={"freedom_flex": {"rotating": 150000}},
            today=TODAY,
        )
        self.assertEqual(result["card_id"], "amex_gold")
        self.assertAlmostEqual(result["reward_cents"], 336.0)
        self.assert_winner_is_max_cash_back(result)

    def test_partial_rotating_cap_yields_when_blended_rate_loses(self):
        # $10 of 5x left on a $45 fill-up is $0.85. Double Cash at 2% is $0.90.
        lost = choose_card(
            self.cards,
            "gas",
            4500,
            caps={"freedom_flex": {"rotating": 149000}},
            today=TODAY,
        )
        self.assertEqual(lost["card_id"], "double_cash")
        self.assertAlmostEqual(lost["reward_cents"], 90.0)
        flex = next(row for row in lost["ranking"] if row["card_id"] == "freedom_flex")
        self.assertAlmostEqual(flex["reward_cents"], 85.0)

        # $20 at 5x plus $25 at 1x is $1.25, which still beats 2% ($0.90).
        kept = choose_card(
            self.cards,
            "gas",
            4500,
            caps={"freedom_flex": {"rotating": 148000}},
            today=TODAY,
        )
        self.assertEqual(kept["card_id"], "freedom_flex")
        self.assertAlmostEqual(kept["reward_cents"], 125.0)

    def test_exhausted_bonus_caps_fall_through_to_double_cash(self):
        result = choose_card(
            self.cards,
            "groceries",
            8400,
            caps={
                "freedom_flex": {"rotating": 150000},
                "amex_gold": {"groceries": 2500000},
            },
            today=TODAY,
        )
        self.assertEqual(result["card_id"], "double_cash")
        self.assertAlmostEqual(result["reward_cents"], 168.0)
        self.assert_winner_is_max_cash_back(result)

    def test_unlinked_card_is_not_selected(self):
        linked = [dict(card) for card in self.cards]
        for card in linked:
            if card["id"] == "amex_gold":
                card["in_wallet"] = False
        result = choose_card(linked, "dining", 600, today=TODAY)
        # Next best dining rate is Sapphire: $6 × 3x × 1.25¢ = $0.225.
        self.assertEqual(result["card_id"], "sapphire_pref")
        self.assertAlmostEqual(result["reward_cents"], 22.5)
        self.assertNotIn("amex_gold", {row["card_id"] for row in result["ranking"]})

    def test_zero_apr_card_never_beats_cash_back(self):
        result = choose_card(self.cards, "other", 129900, today=TODAY)
        self.assertEqual(result["card_id"], "double_cash")
        self.assertAlmostEqual(result["reward_cents"], 2598.0)
        reflect = next(row for row in result["ranking"] if row["card_id"] == "reflect")
        self.assertAlmostEqual(reflect["reward_cents"], 0.0)
        self.assertGreater(result["reward_cents"], reflect["reward_cents"])

    def test_every_purchase_selects_the_max_cash_back(self):
        scenarios = [(m["category"], m["amount_cents"], {}) for m in self.merchants.values()]
        scenarios.extend(
            [
                ("gas", 4500, {"freedom_flex": {"rotating": 150000}}),
                ("gas", 4500, {"freedom_flex": {"rotating": 149000}}),
                ("gas", 4500, {"freedom_flex": {"rotating": 148000}}),
                ("groceries", 8400, {"freedom_flex": {"rotating": 150000}}),
                ("dining", 600, {}),
                ("drugstore", 2500, {}),
                ("travel", 32900, {}),
                ("other", 129900, {}),
                ("groceries", 10000000, {"freedom_flex": {"rotating": 150000}}),
            ]
        )
        for category, amount_cents, caps in scenarios:
            result = choose_card(self.cards, category, amount_cents, caps=caps, today=TODAY)
            self.assert_winner_is_max_cash_back(result)

        # $100,000 of groceries crosses Gold's $25,000 4x cap.
        # 4x on $25,000 plus 1x on the rest is $1,750, behind Double Cash at 2% ($2,000).
        big = choose_card(
            self.cards,
            "groceries",
            10_000_000,
            caps={"freedom_flex": {"rotating": 150000}},
            today=TODAY,
        )
        self.assertEqual(big["card_id"], "double_cash")
        self.assertAlmostEqual(big["reward_cents"], 200000.0)

    def test_merchant_mccs_match_the_category_map(self):
        mcc_map = load_mcc_map()
        for merchant in self.merchants.values():
            if merchant["id"] == "coffee_in_grocery":
                # Intentionally mismatched MCC — resolved by merchant_overrides.
                self.assertEqual(mcc_map[merchant["mcc"]], "groceries")
                self.assertEqual(merchant["category"], "dining")
                continue
            self.assertEqual(mcc_map[merchant["mcc"]], merchant["category"])

    def assert_winner_is_max_cash_back(self, result: dict):
        expected = sorted(result["ranking"], key=lambda row: (-row["reward_cents"], row["card_id"]))
        self.assertEqual(result["card_id"], expected[0]["card_id"])
        self.assertAlmostEqual(result["reward_cents"], expected[0]["reward_cents"])
        self.assertGreaterEqual(result["reward_cents"], max(row["reward_cents"] for row in result["ranking"]))

    def test_partial_cap_splits_bonus_and_default_rate(self):
        flex = next(c for c in self.cards if c["id"] == "freedom_flex")
        # $10 of the $1,500 rotating cap left on a $45 fill-up.
        scored = score_card(flex, "gas", 4500, cap_spent_cents=149000, today=TODAY)
        self.assertEqual(scored["bonus_cents"], 1000)
        self.assertEqual(scored["default_cents"], 3500)
        self.assertAlmostEqual(scored["reward_cents"], 85.0)
        self.assertIn("5x rotating on $10.00 of gas", scored["reason"])
        self.assertIn("1x on $35.00", scored["reason"])

    def test_uncategorized_picks_double_cash(self):
        result = choose_card(self.cards, "other", 2000, today=TODAY)
        self.assertEqual(result["card_id"], "double_cash")
        self.assertAlmostEqual(result["value_cents"], 40.0)  # $20 × 2%

    def test_sapphire_point_value_beats_a_flat_one_x_on_dining_but_not_gold(self):
        coffee = self.merchants["coffee"]
        result = self._choose("coffee")
        sapphire = next(row for row in result["ranking"] if row["card_id"] == "sapphire_pref")
        # $6 × 3x × 1.25¢ = $0.225, behind Gold's $0.24
        self.assertAlmostEqual(sapphire["reward_cents"], 22.5)
        self.assertEqual(result["card_id"], "amex_gold")
        self.assertEqual(coffee["mcc"], "5814")

    def test_tie_breaks_on_card_id(self):
        twins = [
            {"id": "b_card", "point_value_cents": 1.0, "apr": 0, "rates": {"default": 1}},
            {"id": "a_card", "point_value_cents": 1.0, "apr": 0, "rates": {"default": 1}},
        ]
        result = choose_card(twins, "other", 1000, today=TODAY)
        self.assertEqual(result["card_id"], "a_card")

    def test_edge_mccs_route_to_expected_winners(self):
        cases = [
            ("restaurant", "amex_gold"),       # 5812 dining
            ("meat_market", "freedom_flex"),   # 5422 groceries → rotating
            ("gas_station", "freedom_flex"),   # 5541 gas → rotating
            ("drugstore", "freedom_flex"),     # 5912, ties Unlimited at 3x
            ("flight", "amex_gold"),           # 4511 travel 3x > Sapphire 2.5¢
            ("hotel", "amex_gold"),            # 7011 travel
            ("electronics", "double_cash"),    # 5732 other
            ("warehouse", "double_cash"),      # 5300 warehouse clubs → other
            ("department", "double_cash"),     # 5311 department → other
        ]
        for merchant_id, card_id in cases:
            with self.subTest(merchant=merchant_id):
                merchant = self.merchants[merchant_id]
                result = select_card(
                    self.cards,
                    merchant["amount_cents"],
                    merchant["mcc"],
                    today=TODAY,
                )
                self.assertEqual(result["card_id"], card_id)
                self.assertEqual(result["category"], merchant["category"])
                self.assert_winner_is_max_cash_back(result)

    def test_cap_schema_exposes_real_periods(self):
        flex = next(c for c in self.cards if c["id"] == "freedom_flex")
        gold = next(c for c in self.cards if c["id"] == "amex_gold")
        self.assertEqual(flex["caps"]["rotating"]["limit_cents"], 150000)
        self.assertEqual(flex["caps"]["rotating"]["period"], "quarter")
        self.assertEqual(gold["caps"]["groceries"]["limit_cents"], 2500000)
        self.assertEqual(gold["caps"]["groceries"]["period"], "calendar_year")

    def _choose(self, merchant_id: str) -> dict:
        merchant = merchant_by_id(list(self.merchants.values()), merchant_id)
        return choose_card(
            self.cards,
            merchant["category"],
            merchant["amount_cents"],
            today=TODAY,
        )


if __name__ == "__main__":
    unittest.main()
