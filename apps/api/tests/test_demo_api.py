"""Cap status + varied demo script."""

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

    def test_demo_script_varied_merchants(self):
        res = self.client.post("/demo/script", json={"reset": True})
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertTrue(body["ok"], body)
        self.assertTrue(body["reset"])
        self.assertGreaterEqual(len(body["steps"]), 5)

        merchants = [s["merchant_id"] for s in body["steps"]]
        self.assertEqual(len(merchants), len(set(merchants)), merchants)
        self.assertIn("starbucks", merchants)
        self.assertIn("shell", merchants)
        self.assertIn("whole_foods", merchants)
        self.assertIn("best_buy", merchants)
        self.assertIn("starbucks_whole_foods", merchants)

        by_name = {s["name"]: s for s in body["steps"]}
        self.assertEqual(by_name["starbucks"]["transaction"]["selected_card_id"], "amex_gold")
        self.assertEqual(by_name["gas_burn"]["transaction"]["selected_card_id"], "freedom_flex")
        self.assertEqual(by_name["whole_foods"]["transaction"]["selected_card_id"], "amex_gold")
        self.assertEqual(by_name["best_buy"]["transaction"]["selected_card_id"], "double_cash")
        self.assertEqual(
            by_name["starbucks_whole_foods"]["transaction"]["selected_card_id"], "amex_gold"
        )

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
        txs = self.client.get("/transactions").json()
        self.assertEqual(len(txs), len(first["steps"]))


if __name__ == "__main__":
    unittest.main()
