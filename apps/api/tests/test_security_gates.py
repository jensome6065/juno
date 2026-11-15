"""Demo key gate, audit trail, and webhook reject logging."""

import hashlib
import hmac
import json
import os
import time
import unittest

from fastapi.testclient import TestClient

from app.main import app
from app.store import configure_test_db, reset

DEMO_KEY = "test-demo-key"
DEMO_HEADERS = {"X-Demo-Key": DEMO_KEY}


def _sign(payload: bytes, secret: str) -> str:
    timestamp = str(int(time.time()))
    signed = f"{timestamp}.{payload.decode('utf-8')}"
    digest = hmac.new(secret.encode("utf-8"), signed.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={digest}"


class SecurityGatesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        configure_test_db("sqlite+pysqlite:///:memory:")
        cls.client = TestClient(app)

    def setUp(self):
        reset()
        self._old = {
            "DEMO_API_KEY": os.environ.get("DEMO_API_KEY"),
            "STRIPE_WEBHOOK_SECRET": os.environ.get("STRIPE_WEBHOOK_SECRET"),
            "STRIPE_SECRET_KEY": os.environ.get("STRIPE_SECRET_KEY"),
        }
        os.environ["DEMO_API_KEY"] = DEMO_KEY
        os.environ["STRIPE_WEBHOOK_SECRET"] = "whsec_test_secret"
        os.environ["STRIPE_SECRET_KEY"] = ""

    def tearDown(self):
        for key, value in self._old.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        reset()

    def test_simulate_requires_demo_key(self):
        denied = self.client.post(
            "/simulate",
            json={"merchant_id": "starbucks", "authorization_id": "auth_denied"},
        )
        self.assertEqual(denied.status_code, 401)

        ok = self.client.post(
            "/simulate",
            json={"merchant_id": "starbucks", "authorization_id": "auth_ok"},
            headers=DEMO_HEADERS,
        )
        self.assertEqual(ok.status_code, 200, ok.text)

    def test_demo_script_requires_demo_key(self):
        denied = self.client.post("/demo/script", json={"reset": True})
        self.assertEqual(denied.status_code, 401)

        ok = self.client.post(
            "/demo/script",
            json={"reset": True},
            headers=DEMO_HEADERS,
        )
        self.assertEqual(ok.status_code, 200, ok.text)

    def test_security_status_flags(self):
        res = self.client.get("/security/status")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertTrue(body["demo_api_key_configured"])
        self.assertTrue(body["audit_log_enabled"])
        self.assertTrue(body["rate_limit_enabled"])

    def test_webhook_rejects_are_audited(self):
        unsigned = self.client.post("/webhooks/stripe", content=b"{}")
        self.assertEqual(unsigned.status_code, 400)

        bad = self.client.post(
            "/webhooks/stripe",
            content=b'{"id":"evt_1"}',
            headers={"Stripe-Signature": "t=1,v1=deadbeef"},
        )
        self.assertEqual(bad.status_code, 400)

        audit = self.client.get("/security/audit").json()
        outcomes = [row["outcome"] for row in audit]
        self.assertIn("rejected", outcomes)
        actions = [row["action"] for row in audit]
        self.assertIn("webhook.rejected", actions)

    def test_routed_and_replay_appear_in_audit(self):
        first = self.client.post(
            "/simulate",
            json={
                "merchant_id": "starbucks",
                "authorization_id": "audit_auth_1",
            },
            headers=DEMO_HEADERS,
        )
        self.assertEqual(first.status_code, 200, first.text)
        second = self.client.post(
            "/simulate",
            json={
                "merchant_id": "starbucks",
                "authorization_id": "audit_auth_1",
            },
            headers=DEMO_HEADERS,
        )
        self.assertTrue(second.json()["idempotent_replay"])

        audit = self.client.get("/security/audit").json()
        actions = [row["action"] for row in audit]
        self.assertIn("decision.routed", actions)
        self.assertIn("decision.replay", actions)

    def test_demo_reset_keeps_audit(self):
        self.client.post("/webhooks/stripe", content=b"{}")
        before = self.client.get("/security/audit").json()
        self.assertGreaterEqual(len(before), 1)

        reset_res = self.client.post("/demo/reset", headers=DEMO_HEADERS)
        self.assertEqual(reset_res.status_code, 200, reset_res.text)

        after = self.client.get("/security/audit").json()
        self.assertGreaterEqual(len(after), len(before))
        self.assertTrue(any(row["action"] == "demo.reset" for row in after))

    def test_valid_webhook_still_routes(self):
        body = {
            "id": "evt_audit_1",
            "type": "issuing_authorization.request",
            "data": {
                "object": {
                    "id": "iauth_audit_1",
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
        headers = {"Stripe-Signature": _sign(payload, "whsec_test_secret")}
        res = self.client.post("/webhooks/stripe", content=payload, headers=headers)
        self.assertEqual(res.status_code, 200, res.text)
        audit = self.client.get("/security/audit").json()
        self.assertTrue(any(row["action"] == "webhook.accepted" for row in audit))


if __name__ == "__main__":
    unittest.main()
