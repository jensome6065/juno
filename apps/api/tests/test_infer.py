"""Free-text merchant inference + simulate without catalog id."""

import os
import unittest

from fastapi.testclient import TestClient

from app.main import app
from app.store import configure_test_db, reset

DEMO_HEADERS = {"X-Demo-Key": "test-demo-key"}


class InferApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        configure_test_db("sqlite+pysqlite:///:memory:")
        cls.client = TestClient(app)

    def setUp(self):
        reset()
        self._old_key = os.environ.get("DEMO_API_KEY")
        os.environ["DEMO_API_KEY"] = "test-demo-key"

    def tearDown(self):
        if self._old_key is None:
            os.environ.pop("DEMO_API_KEY", None)
        else:
            os.environ["DEMO_API_KEY"] = self._old_key

    def test_infer_override_coffee_in_grocery(self):
        res = self.client.post(
            "/infer",
            json={"merchant_name": "Starbucks Reserve", "mcc": "5411"},
            headers=DEMO_HEADERS,
        )
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(body["category"], "dining")
        self.assertEqual(body["source"], "override")
        self.assertEqual(body["mcc_category"], "groceries")

    def test_infer_from_mcc_alone(self):
        res = self.client.post(
            "/infer",
            json={"merchant_name": "Random Fuel Mart", "mcc": "5542"},
            headers=DEMO_HEADERS,
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["category"], "gas")
        self.assertEqual(body["source"], "mcc")

    def test_simulate_free_text_routes(self):
        res = self.client.post(
            "/simulate",
            json={
                "merchant_name": "Joe's Corner Cafe",
                "mcc": "5812",
                "amount": 18.5,
                "authorization_id": "free_text_auth_1",
            },
            headers=DEMO_HEADERS,
        )
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(body["transaction"]["merchant_name"], "Joe's Corner Cafe")
        self.assertEqual(body["transaction"]["category"], "dining")
        self.assertEqual(body["transaction"]["selected_card_id"], "amex_gold")
        self.assertEqual(body["intel"]["category_source"], "mcc")


if __name__ == "__main__":
    unittest.main()

