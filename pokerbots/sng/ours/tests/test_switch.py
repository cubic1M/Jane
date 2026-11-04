"""icm_switch: plays icm_tag until icm_tag's attacked-opens lock engages, then f7_balanced; legal throughout."""
import unittest

from sng.registry import make
from sng.rules import SngRules
from sng.table import play_table


class TestSwitch(unittest.TestCase):
    def test_switches_once_when_the_lock_engages(self):
        b = make("icm_switch")
        b.new_table(SngRules(enforce_time=False), 0, 1)
        self.assertFalse(b.switched)
        b.a.rfi_on = True                                   # the lock engaged
        post = ((1, 0, "post", 10), (2, 0, "post", 20), (3, 0, "fold", 0))
        b.end_hand(dict(history=post, stacks=(2000,) * 8, hand_number=5, deltas=[0] * 8))
        self.assertTrue(b.switched)
        self.assertEqual(b.switch_hand, 5)
        b.new_table(SngRules(enforce_time=False), 0, 2)    # a new table starts as icm_tag
        self.assertFalse(b.switched)

    def test_legal_on_attacking_and_static_fields(self):
        for line in (["icm_switch", "f7_profiler", "f7_balanced", "f6_raiser", "f6_floater", "f7_bully", "f6_checkraiser", "f7_trickster"],
                     ["icm_switch", "station", "nit", "lag", "chen_tag", "pushfold_icm", "random", "maniac"]):
            res = play_table([make(n) for n in line], SngRules(enforce_time=False), seed=3)
            self.assertEqual(res.stats[0].errors + res.stats[0].illegal, 0)
            self.assertEqual(sum(res.final_stacks), 16000)


    def test_strong_bot_choice_and_any_deck_rule(self):
        """b= picks the strong-table bot; any_deck=1 lets the share rule fire on a short deck."""
        from sng.field9.bots import Meta
        from sng.presets import PRESETS
        six = SngRules(enforce_time=False, spec=PRESETS["kit4_sixplus"]["spec"])
        post = ((1, 0, "post", 10), (2, 0, "post", 20), (3, 0, "fold", 0))
        for any_deck, want in ((0, False), (1, True)):
            b = make(f"icm_switch:b=f9_meta;switch_share=0.25;switch_min=10;any_deck={any_deck}")
            self.assertIsInstance(b.b, Meta)
            b.new_table(six, 0, 1)
            b.a.my_opens, b.a.my_opens_rr = 12, 4          # 33% of 12 opens re-raised
            b.end_hand(dict(history=post, stacks=(2000,) * 8, hand_number=30, deltas=[0] * 8))
            self.assertEqual(b.switched, want)
            self.assertEqual(b.b.shadow_only, not want)     # the shadow skips ICM until it takes over
            if want:
                self.assertEqual(b.b.icm.stacks, [2000] * 8)

    def test_legal_with_field9_strong_bot(self):
        line = ["icm_switch:b=f9_meta;switch_share=0.2;switch_min=5;any_deck=1", "f9_threebet", "f9_bubble", "f9_meta",
                "f7_balanced", "f8_ensemble", "f9_float", "f9_limptrap"]
        res = play_table([make(n) for n in line], SngRules(enforce_time=False), seed=4)
        self.assertEqual(res.stats[0].errors + res.stats[0].illegal, 0)
        self.assertEqual(sum(res.final_stacks), 16000)

if __name__ == "__main__":
    unittest.main()
