"""icm_switch: icm_tag until the table attacks our opens, then a stronger "strong-table" bot.

icm_tag beats weak and static fields by a lot (it exploits folders and stations) but finishes last
at tables of strong bots that re-raise wide openers (fields 6 / 7, the champions table), where
f7_balanced is the strongest bot we have (results/sng_bestbot_*.md). icm_tag's own detector
(rfi_lock: >= 30% of 20+ first-in opens re-raised, 52-card deck, not-top-heavy payouts) decides,
at a hand boundary and one-way, when f7_balanced takes over. f7_balanced shadows every hand from
the start (end_hand feeds its opponent stats), so it is warm when it takes over.
"""
from __future__ import annotations

from sng.field7.bots import Balanced
from sng.ours.icm_tag import IcmTag


class IcmSwitch:
    name = "icm_switch"

    def __init__(self, **kw):
        self.a = IcmTag(**kw)
        self.b = Balanced()
        self.switched = False
        self.switch_hand = None

    def new_table(self, rules, seat, seed=0):
        self.a.new_table(rules, seat, seed)
        self.b.new_table(rules, seat, seed + 1)
        self.switched = False
        self.switch_hand = None

    def act(self, obs):
        return (self.b if self.switched else self.a).act(obs)

    def end_hand(self, info):
        self.a.end_hand(info)
        try:
            self.b.end_hand(info)
        except Exception:  # noqa: BLE001  the shadow bot must never cost a decision
            pass
        if not self.switched and self.a.rfi_on:
            self.switched = True
            self.switch_hand = info.get("hand_number")
