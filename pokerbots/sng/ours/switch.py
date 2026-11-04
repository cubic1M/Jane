"""icm_switch: icm_tag until the table attacks our opens, then a stronger "strong-table" bot.

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


class IcmSwitch:
    name = "icm_switch"

    def __init__(self, switch_min=20, switch_share=0.0, b="f7", any_deck=0, **kw):
        # switch_share > 0: hand over only after switch_min first-in opens with >= switch_share of them
        # re-raised (stricter than the opening-range lock, which fires on noise at static fields); 0 = with the lock
        self.switch_min, self.switch_share = int(switch_min), float(switch_share)
        self.any_deck = bool(any_deck)        # 1: the share rule also fires on short decks / top-heavy payouts
        self.a = IcmTag(**kw)
        self.b = _strong_bot(str(b))
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
        a = self.a
        if self.switch_share > 0:
            fire = ((a.rfi_ok2 or self.any_deck) and a.my_opens >= self.switch_min
                    and a.my_opens_rr >= self.switch_share * a.my_opens)
        else:
            fire = a.rfi_on
        if not self.switched and fire:
            self.switched = True
            self.switch_hand = info.get("hand_number")
