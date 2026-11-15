"""Security checks for the Stripe authorization webhook."""

import hashlib
import hmac
import json
import time
import unittest

from fastapi.testclient import TestClient

from app.main import app
from app.store import configure_test_db, reset


def _sign(payload: bytes, secret: str) -> str:
    timestamp = str(int(time.time()))
    signed = f"{timestamp}.{payload.decode('utf-8')}"
    digest = hmac.new(secret.encode("utf-8"), signed.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={digest}"


class StripeWebhookSecurityTest(unittest.TestCase):
    def setUp(self):
        configure_test_db("sqlite+pysqlite:///:memory:")
        reset()
        self.client = TestClient(app)
        self.secret = "whsec_test_secret"
        import os

        self._env = {
            "STRIPE_WEBHOOK_SECRET": self.secret,
            "STRIPE_SECRET_KEY": "",
        }
        self._old = {k: os.environ.get(k) for k in self._env}
        os.environ.update(self._env)

    def tearDown(self):
        import os

        for key, value in self._old.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        reset()

    def test_missing_secret_is_unavailable(self):
        import os

        os.environ.pop("STRIPE_WEBHOOK_SECRET", None)
        response = self.client.post("/webhooks/stripe", content=b"{}")
        self.assertEqual(response.status_code, 503)

    def test_missing_signature_is_rejected(self):
        response = self.client.post("/webhooks/stripe", content=b"{}")
        self.assertEqual(response.status_code, 400)
        self.assertIn("Stripe-Signature", response.json()["detail"])

    def test_invalid_signature_is_rejected(self):
        response = self.client.post(
            "/webhooks/stripe",
            content=b'{"id":"evt_1"}',
            headers={"Stripe-Signature": "t=1,v1=deadbeef"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "Invalid signature")

    def test_valid_issuing_authorization_routes_once(self):
        body = {
            "id": "evt_test_1",
            "type": "issuing_authorization.request",
            "data": {
                "object": {
                    "id": "iauth_test_1",
                    "amount": 650,
                    "pending_request": {"amount": 650},
                    "merchant_data": {
                        "name": "Blue Bottle Coffee",
                        "category_code": "5814",
                    },
                }
            },
        }
        payload = json.dumps(body, separators=(",", ":")).encode("utf-8")
        headers = {"Stripe-Signature": _sign(payload, self.secret)}

        first = self.client.post("/webhooks/stripe", content=payload, headers=headers)
        self.assertEqual(first.status_code, 200, first.text)
        data = first.json()
        self.assertTrue(data["signature_verified"])
        self.assertFalse(data["idempotent_replay"])
        self.assertEqual(data["authorization_id"], "iauth_test_1")
        self.assertIn("selected_card", data)

        second = self.client.post("/webhooks/stripe", content=payload, headers=headers)
        self.assertEqual(second.status_code, 200, second.text)
        self.assertTrue(second.json()["idempotent_replay"])
        self.assertEqual(second.json()["selected_card"], data["selected_card"])


if __name__ == "__main__":
    unittest.main()
