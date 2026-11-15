"""Cap status + 3-beat demo script."""

import unittest

from fastapi.testclient import TestClient

from app.main import app
from app.store import configure_test_db, reset


class DemoApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        configure_test_db("sqlite+pysqlite:///:memory:")
        cls.client = TestClient(app)

    def setUp(self):
        reset()

    def test_caps_empty_meters(self):
        res = self.client.get("/caps")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIn("as_of", body)
        flex = body["caps"]["freedom_flex"]["rotating"]
        gold = body["caps"]["amex_gold"]["groceries"]
        self.assertEqual(flex["spent_cents"], 0)
        self.assertEqual(flex["limit_cents"], 150000)
        self.assertEqual(flex["remaining_cents"], 150000)
        self.assertEqual(flex["period"], "quarter")
        self.assertEqual(flex["progress"], 0.0)
        self.assertEqual(gold["limit_cents"], 2500000)
        self.assertEqual(gold["period"], "calendar_year")

    def test_demo_script_three_beats(self):
        res = self.client.post("/demo/script", json={"reset": True})
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertTrue(body["ok"], body)
        self.assertTrue(body["reset"])
        self.assertEqual(len(body["steps"]), 3)

        coffee, gas, override = body["steps"]
        self.assertEqual(coffee["merchant_id"], "coffee")
        self.assertEqual(coffee["transaction"]["selected_card_id"], "amex_gold")
        self.assertTrue(coffee["ok"])

        self.assertEqual(gas["merchant_id"], "gas")
        self.assertEqual(gas["transaction"]["selected_card_id"], "freedom_flex")
        self.assertTrue(gas["ok"])

        self.assertEqual(override["merchant_id"], "coffee_in_grocery")
        self.assertEqual(override["transaction"]["selected_card_id"], "amex_gold")
        self.assertTrue(override["ok"])

        flex = body["caps"]["caps"]["freedom_flex"]["rotating"]
        self.assertEqual(flex["spent_cents"], 150000)
        self.assertEqual(flex["remaining_cents"], 0)
        self.assertEqual(flex["progress"], 1.0)

    def test_demo_script_is_idempotent_after_reset(self):
        first = self.client.post("/demo/script", json={"reset": True}).json()
        second = self.client.post("/demo/script", json={"reset": True}).json()
        self.assertTrue(first["ok"])
        self.assertTrue(second["ok"])
        self.assertEqual(
            [s["authorization_id"] for s in first["steps"]],
            [s["authorization_id"] for s in second["steps"]],
        )
        # Fresh reset → still three txs, not six.
        txs = self.client.get("/transactions").json()
        self.assertEqual(len(txs), 3)


if __name__ == "__main__":
    unittest.main()
