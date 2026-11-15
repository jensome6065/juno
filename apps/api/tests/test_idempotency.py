"""Postgres/SQLite data plane: authorization_id uniqueness + no PAN storage."""

import unittest

from app.services.rules import get_card, load_cards
from app.store import (
    FORBIDDEN_PAN_KEYS,
    add_transaction,
    configure_test_db,
    get_cap_ledger,
    get_caps,
    get_transaction_by_authorization,
    list_transactions,
    reset,
)


class IdempotencyStoreTest(unittest.TestCase):
    def setUp(self):
        configure_test_db("sqlite+pysqlite:///:memory:")
        reset()
        self.cards = load_cards()
        self.flex = get_card("freedom_flex")

    def _gas_tx(self, authorization_id: str) -> dict:
        return {
            "authorization_id": authorization_id,
            "merchant_name": "Shell",
            "merchant_id": "gas",
            "mcc": "5542",
            "category": "gas",
            "category_confidence": 0.8,
            "category_source": "mcc",
            "amount": 45.0,
            "selected_card_id": "freedom_flex",
            "selected_card_name": "Chase Freedom Flex",
            "default_card_name": "1% baseline",
            "reward_value": 2.25,
            "default_reward_value": 0.45,
            "extra_value": 1.80,
            "reason": "5x rotating on gas → $2.25 (vs $0.45 at 1%)",
        }

    def test_replay_same_authorization_inserts_one_row(self):
        first = add_transaction(self._gas_tx("auth_shell_1"), card=self.flex)
        self.assertFalse(first["idempotent_replay"])
        self.assertEqual(first["authorization_id"], "auth_shell_1")

        second = add_transaction(self._gas_tx("auth_shell_1"), card=self.flex)
        self.assertTrue(second["idempotent_replay"])
        self.assertEqual(second["id"], first["id"])

        self.assertEqual(len(list_transactions()), 1)
        caps = get_caps(self.cards)
        # Cap credited once: $45 toward rotating.
        self.assertEqual(caps["freedom_flex"]["rotating"], 4500)
        ledger = get_cap_ledger()
        self.assertEqual(sum(1 for k in ledger if k.startswith("freedom_flex|rotating|")), 1)

    def test_distinct_authorizations_both_persist(self):
        add_transaction(self._gas_tx("auth_a"), card=self.flex)
        add_transaction(self._gas_tx("auth_b"), card=self.flex)
        self.assertEqual(len(list_transactions()), 2)
        self.assertEqual(get_caps(self.cards)["freedom_flex"]["rotating"], 9000)

    def test_lookup_by_authorization_id(self):
        add_transaction(self._gas_tx("auth_lookup"), card=self.flex)
        found = get_transaction_by_authorization("auth_lookup")
        self.assertIsNotNone(found)
        self.assertEqual(found["selected_card_id"], "freedom_flex")
        self.assertIsNone(get_transaction_by_authorization("missing"))

    def test_rejects_raw_pan_fields(self):
        payload = self._gas_tx("auth_pan")
        payload["pan"] = "4111111111111111"
        with self.assertRaises(ValueError) as ctx:
            add_transaction(payload, card=self.flex)
        self.assertIn("pan", str(ctx.exception).lower())
        self.assertEqual(list_transactions(), [])

    def test_forbidden_pan_key_set_is_explicit(self):
        self.assertIn("pan", FORBIDDEN_PAN_KEYS)
        self.assertIn("cvv", FORBIDDEN_PAN_KEYS)
        self.assertIn("track2", FORBIDDEN_PAN_KEYS)


if __name__ == "__main__":
    unittest.main()
