"""The pre-trained policy library kept in git (cache/cfr/full_*_15m_w4.pkl).

Every listed file must be intact (sha256 manifest), trained for the variant its name
says, carry real training (iterations), and play legal poker within the time limits.
    python3 -m unittest bots.tests.test_library
"""
import hashlib
import os
import time
import unittest

from bots.cfr_full.policy import load_policy, load_policy_data
from bots.random_legal import RandomLegalBot
from bots.full_cfr import DEFAULT_DIR, make_bot
from engine.match import play_match
from engine.variants import ALL_VARIANTS

MANIFEST = os.path.join(DEFAULT_DIR, "LIBRARY.sha256")


def entries():
    if not os.path.exists(MANIFEST):
        return []
    return [line.split() for line in open(MANIFEST) if line.strip()]


@unittest.skipUnless(entries(), "no policy library in cache/cfr")
class TestLibrary(unittest.TestCase):
    def test_every_policy_file_is_listed_and_intact(self):
        listed = {name for _, name in entries()}
        on_disk = {f for f in os.listdir(DEFAULT_DIR) if f.endswith("_15m_w4.pkl")}
        self.assertEqual(on_disk - listed, set(), "rerun: python3 -m experiments.train_library --manifest-only")
        for digest, name in entries():
            with open(os.path.join(DEFAULT_DIR, name), "rb") as f:
                self.assertEqual(hashlib.sha256(f.read()).hexdigest(), digest, name)

    def test_policies_match_their_variant_and_are_trained(self):
        for _, name in entries():
            v = name[len("full_"):-len("_15m_w4.pkl")]
            self.assertIn(v, ALL_VARIANTS, name)
            path = os.path.join(DEFAULT_DIR, name)
            load_policy(path, ALL_VARIANTS[v])          # raises on a spec mismatch
            meta = load_policy_data(path)["meta"]
            self.assertGreater(meta["iterations"], 1000, f"{name}: {meta['iterations']} iterations")

    def test_policies_play_legally_and_fast(self):
        for _, name in entries():
            v = name[len("full_"):-len("_15m_w4.pkl")]
            spec = ALL_VARIANTS[v]
            for seat in (0, 1):
                bot = make_bot(budget="15m_w4", verbose=False)
                pair = (bot, RandomLegalBot()) if seat == 0 else (RandomLegalBot(), bot)
                t0 = time.time()
                r = play_match(pair[0], pair[1], spec, deal_seed=11 + seat, hands=30)
                st = r.stats[seat].summary()
                self.assertFalse(bot.using_fallback, name)
                self.assertEqual((st["illegal"], st["errors"]), (0, 0), f"{name}: {st['first_error']}")
                self.assertLess(time.time() - t0, 30, name)


if __name__ == "__main__":
    unittest.main()
