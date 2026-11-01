"""Where does a bot lose chips against one opponent? Per-street fold-to-bet by bet size
(vs minimum defence frequency), and chips by how the hand ended.

    python3 -m experiments.diag_matchup --bot champion@15m_w4 --opp opp_exploit --variant a_nlhe100
"""
from __future__ import annotations

import argparse
from collections import defaultdict

import numpy as np

from engine.match import play_match
from engine.variants import get_variant
from experiments.common import make_bot

BUCKETS = ((0, 0.4, "<40%"), (0.4, 0.8, "40-80%"), (0.8, 1.3, "80-130%"), (1.3, 99, ">130%"))


class Spy:
    """Wraps the bot under study: logs every decision that faces a bet."""

    def __init__(self, inner, log):
        self.inner, self.log = inner, log
        self.name = getattr(inner, "name", "bot")

    def new_match(self, spec, seed=0):
        self.inner.new_match(spec, seed)

    def end_hand(self, r):
        self.inner.end_hand(r)
        self.log["hands"].append(r)

    def end_match(self):
        if hasattr(self.inner, "end_match"):
            self.inner.end_match()

    def act(self, obs):
        a = self.inner.act(obs)
        lg = obs.legal
        if obs.phase == "bet" and lg.call_amount > 0 and obs.street > 0:
            pot_before = obs.pot - lg.call_amount           # pot before the opponent's bet
            frac = lg.call_amount / max(1, pot_before)
            b = next(name for lo, hi, name in BUCKETS if lo <= frac < hi)
            self.log["facing"][(obs.street, b)].append((a.kind, frac))
        return a

    def __getattr__(self, k):
        return getattr(self.inner, k)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--bot", default="champion@15m_w4")
    ap.add_argument("--opp", default="opp_exploit")
    ap.add_argument("--variant", default="a_nlhe100")
    ap.add_argument("--matches", type=int, default=6)
    ap.add_argument("--hands", type=int, default=1000)
    ap.add_argument("--seed0", type=int, default=80000)
    a = ap.parse_args(argv)
    spec = get_variant(a.variant)
    log = dict(facing=defaultdict(list), hands=[])
    for m in range(a.matches):
        seat = m % 2
        me = Spy(make_bot(a.bot), log)
        opp = make_bot(a.opp)
        pair = (me, opp) if seat == 0 else (opp, me)
        play_match(pair[0], pair[1], spec, deal_seed=a.seed0 + m // 2, hands=a.hands)
    bb = spec.big_blind
    print(f"{a.bot} vs {a.opp} on {a.variant}: {len(log['hands'])} hands")
    print("\nfacing a bet postflop: fold / call / raise share (MDF = defend at least pot/(pot+bet))")
    for st in sorted({k[0] for k in log["facing"]}):
        for _, _, b in BUCKETS:
            xs = log["facing"].get((st, b), [])
            if not xs:
                continue
            kinds = [k for k, _ in xs]
            f = np.mean([np.mean([fr for _, fr in xs])])
            mdf = 1 / (1 + f)
            fold = kinds.count("fold") / len(kinds)
            print(f"  street {st} {b:8s} n={len(xs):5d}  fold {fold:5.0%}  call {kinds.count('call') / len(kinds):5.0%}"
                  f"  raise {kinds.count('raise') / len(kinds):5.0%}   max fold by MDF {1 - mdf:4.0%}"
                  f"{'   OVERFOLD' if fold > 1 - mdf + 0.08 else ''}")
    cats = defaultdict(list)
    for r in log["hands"]:
        if r.folded_by is None:
            c = "showdown"
        elif r.folded_by == r.position:
            c = f"we fold st{max([h.street for h in r.history] or [0])}"
        else:
            c = f"they fold st{max([h.street for h in r.history] or [0])}"
        cats[c].append(r.delta / bb)
    n = len(log["hands"])
    print("\nchips by how the hand ended (bb per 100 hands of the whole match):")
    for c in sorted(cats):
        xs = cats[c]
        print(f"  {c:14s} {len(xs):6d} hands  {100 * sum(xs) / n:+8.1f} bb/100")
    print(f"  {'total':14s} {n:6d} hands  {100 * sum(sum(v) for v in cats.values()) / n:+8.1f} bb/100")


if __name__ == "__main__":
    main()
