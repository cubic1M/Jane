"""icm_switch: icm_tag until the table attacks our opens, then a stronger "strong-table" bot
(52-card hold'em: f9_meta when icm_tag's lock fires (b="f7": f7_balanced, the first version); six-plus deck:
f9_meta once >= 30% of 20+ opens were re-raised).

icm_tag beats weak and static fields by a lot (it exploits folders and stations) but finishes last
at tables of strong bots that re-raise wide openers (fields 6 / 7, the champions table), where
f7_balanced is the strongest bot we have (results/sng_bestbot_*.md). icm_tag's own detector
(rfi_lock: >= 30% of 20+ first-in opens re-raised, 52-card deck, not-top-heavy payouts) decides,
at a hand boundary and one-way, when f7_balanced takes over. f7_balanced shadows every hand from
the start (end_hand feeds its opponent stats), so it is warm when it takes over.
"""
from __future__ import annotations

from sng.ours.icm_tag import IcmTag


def _strong_bot(name):
    """The strong-table bot: "f7" = field 7's Balanced (bundled with --with-switch); "f9_meta" /
    "f9_threebet" / "f9_bubble" = field 9 bots (numpy + 3.9 MB of tables; their end_hand costs
    p50 0.5 / p99 2 ms, which counts inside the next decision in one-call-per-decision interfaces)."""
    if name == "f7":
        from sng.field7.bots import Balanced
        return Balanced()
    from sng.field9 import bots as f9
    return {"f9_meta": f9.Meta, "f9_threebet": f9.ThreeBet, "f9_bubble": f9.Bubble}[name]()


F9_ICM_MAX_ALIVE = 8   # field 9 exact ICM only with <= 8 players alive (cost grows exponentially)


def _full_rules(rules):
    """The strong-table bots read the whole SngRules (starting_stack, blinds_for, ...); kit adapters
    often pass a small stand-in (spec, num_players, payouts): fill the rest with the format's defaults."""
    if hasattr(rules, "blinds_for") and hasattr(rules, "starting_stack"):
        return rules
    from sng.rules import SngRules
    kw = {}
    for k in ("spec", "num_players", "payouts", "max_hands", "blinds", "antes", "hands_per_level", "bounty"):
        v = getattr(rules, k, None)
        if v is not None:
            kw[k] = tuple(v) if k in ("payouts", "blinds", "antes") else v
    sp = kw.get("spec")
    if sp is not None:
        kw["starting_stack"] = getattr(rules, "starting_stack", getattr(sp, "starting_stack", 2000))
    n = kw.get("num_players", 8)
    if "payouts" in kw and len(kw["payouts"]) < n:
        kw["payouts"] = kw["payouts"] + (0,) * (n - len(kw["payouts"]))
    return SngRules(enforce_time=False, **kw)


class IcmSwitch:
    name = "icm_switch"

    def __init__(self, switch_min=20, switch_share=0.0, b="f9_meta", any_deck=0, icm_slice=0, sd_share=0.3,
                 sd_b="f9_meta", f9_cache=0.0, start="a", back_share=0.18, f9_min_left=0, hand_back=0, **kw):
        # hand_back=N > 0 (start="a"): after a hand-over, hand the table back to icm_tag (one-way) if of the
        # next N first-in opens fewer than back_share got re-raised (the hand-over fired on noise)
        # start="b": play the strong bot from hand 1 and hand the table BACK to icm_tag (one-way) once
        # >= switch_min first-in opens were played and < back_share of them got re-raised (a static table,
        # where icm_tag is far better); start="a" (default): icm_tag first, hand-over as above
        # sd_share > 0: on a six-plus deck (where the lock is off) hand over to sd_b once >= sd_share of
        # >= switch_min first-in opens were re-raised (fresh seeds, 10 short-deck cells: +2.7, no significant
        # loss; results/sng_sdswitch_validate.md); 0 = never on short decks
        # switch_share > 0: hand over only after switch_min first-in opens with >= switch_share of them
        # re-raised (stricter than the opening-range lock, which fires on noise at static fields); 0 = with the lock
        self.switch_min, self.switch_share = int(switch_min), float(switch_share)
        self.any_deck = bool(any_deck)        # 1: the share rule also fires on short decks / top-heavy payouts
        self.sd_share, self.sd_name = float(sd_share), str(sd_b)
        self.start_b, self.back_share = str(start) == "b", float(back_share)
        self.hand_back = int(hand_back)
        self._at_switch = (0, 0)
        self.backed = False
        self.a = IcmTag(**kw)
        self.b = self.b_main = _strong_bot(str(b))
        self.b_sd = None
        if self.sd_share > 0:
            try:
                self.b_sd = _strong_bot(self.sd_name)
            except Exception:  # noqa: BLE001  (e.g. a bundle without field 9): short decks stay icm_tag
                self.b_sd = None
        for bb in (self.b_main, self.b_sd):
            if bb is not None:
                self._setup_strong(bb, icm_slice)
                if hasattr(bb, "icm_cache"):
                    bb.icm_cache = float(f9_cache)   # field 9: skip the ICM while stacks move < f9_cache
                    # field 9: no ICM while > f9_min_left players alive. Unset, the cap is 8: exact ICM grows
                    # exponentially (~3 ms at 9 alive, ~60 ms at 10), so 9-10-handed tables use chip values
                    # until 8 are left; on <= 8-player tables the cap never applies (no change there)
                    bb.icm_min_left = int(f9_min_left) or F9_ICM_MAX_ALIVE
        self.switched = False
        self.switch_hand = None
        self.short = False
        self.b_ok = False

    @staticmethod
    def _setup_strong(bb, icm_slice):
        bb.shadow_only = True                # opponent stats only until it takes over (no ICM in end_hand)
        if hasattr(bb, "icm_fast"):
            bb.icm_fast = True                   # f7: batched ICM (same values, ~3x faster)
        if hasattr(bb, "icm_slice"):
            bb.icm_slice = int(icm_slice)        # f7 after the hand-over: <= icm_slice bubble factors per hand

    def new_table(self, rules, seat, seed=0):
        sp = rules.spec
        # the strong-table bots are hold'em bots: hand over only in 2-card high games without discards
        # (no-limit only: every validation was no-limit)
        self.holdem = (sp.hole_cards == 2 and not sp.discards and getattr(sp, "showdown", "high") == "high"
                       and getattr(sp, "betting", "no_limit") == "no_limit")
        # six-plus deck (field 9 has tables for it): the short-deck target and rule
        self.short = (self.b_sd is not None and tuple(sorted(sp.deck_ranks)) == tuple(range(4, 13))
                      and self._sd_tables())
        self.b = self.b_sd if self.short else self.b_main
        self.a.new_table(rules, seat, seed)
        self.switched = False
        self.switch_hand = None
        self.backed = False
        try:
            self.b.new_table(_full_rules(rules), seat, seed + 1)
            self.b.shadow_only = True
            self.b_ok = True
        except Exception:  # noqa: BLE001  a strong bot that cannot start: this table stays icm_tag
            self.b_ok = False
        if self.start_b and self.b_ok and self.holdem:
            self.switched = True                 # the strong bot plays from hand 1
            self.switch_hand = 0
            self.b.shadow_only = False
            self._refresh_b()

    def _sd_tables(self):
        try:
            from sng.field9 import tables9
            return tables9.available("six")
        except Exception:  # noqa: BLE001
            return False

    def act(self, obs):
        return (self.b if self.switched else self.a).act(obs)

    def end_hand(self, info):
        self.a.end_hand(info)
        if not self.b_ok:
            return
        try:
            self.b.end_hand(info)
        except Exception:  # noqa: BLE001  the shadow bot must never cost a decision
            pass
        a = self.a
        if self.start_b:
            if (self.switched and not self.backed and a.my_opens >= self.switch_min
                    and a.my_opens_rr < self.back_share * a.my_opens):
                self.switched = False            # a static table: icm_tag from now on (one-way)
                self.backed = True
                self.b.shadow_only = True
            return
        if self.short:
            fire = a.my_opens >= self.switch_min and a.my_opens_rr >= self.sd_share * a.my_opens
        elif self.switch_share > 0:
            fire = ((a.rfi_ok2 or self.any_deck) and a.my_opens >= self.switch_min
                    and a.my_opens_rr >= self.switch_share * a.my_opens)
        else:
            fire = a.rfi_on
        if self.hand_back and self.switched and not self.backed:
            n0, r0 = self._at_switch
            n, r = a.my_opens - n0, a.my_opens_rr - r0
            if n >= self.hand_back and r < self.back_share * n:
                self.switched = False            # the hand-over fired on noise: back to icm_tag (one-way)
                self.backed = True
                self.b.shadow_only = True
            return
        if not self.switched and fire and self.holdem and not self.backed:
            self.switched = True
            self.switch_hand = info.get("hand_number")
            self._at_switch = (a.my_opens, a.my_opens_rr)
            self.b.shadow_only = False
            self._refresh_b()

    def _refresh_b(self):
        try:
            if hasattr(self.b, "refresh_icm"):
                self.b.refresh_icm(force=True)    # field 9
            else:
                self.b._icm_key = None            # field 7: recompute now
                self.b._update_icm()
        except Exception:  # noqa: BLE001
            pass
