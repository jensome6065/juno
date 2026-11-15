"""Unit-ish latency checks on pure scoring (no I/O)."""

import time
import unittest

from app.engine.decide import Constraints, decide
from app.engine.score import load_cards, score_card


class ScoreLatencyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cards = load_cards()

    def test_single_card_score_is_sub_millisecond(self):
        card = self.cards[0]
        # Warm up.
        score_card(card, "dining", 600)
        samples = []
        for _ in range(200):
            start = time.perf_counter()
            score_card(card, "dining", 600)
            samples.append(time.perf_counter() - start)
        samples.sort()
        p95 = samples[int(0.95 * (len(samples) - 1))]
        self.assertLess(p95, 0.002, f"score_card p95={p95:.6f}s")

    def test_full_decide_ranking_stays_fast(self):
        constraints = Constraints.from_parts(caps={"freedom_flex": {"rotating": 100000}})
        # Warm up.
        decide(self.cards, 8400, mcc="5411", merchant_name="Whole Foods", constraints=constraints)
        start = time.perf_counter()
        iterations = 300
        for i in range(iterations):
            decide(
                self.cards,
                600 + (i % 50),
                mcc="5814",
                merchant_name="Blue Bottle Coffee",
                constraints=constraints,
            )
        elapsed = time.perf_counter() - start
        per_call = elapsed / iterations
        self.assertLess(per_call, 0.005, f"decide avg={per_call:.6f}s over {iterations}")
        self.assertLess(elapsed, 1.0, f"decide batch={elapsed:.4f}s")


if __name__ == "__main__":
    unittest.main()
