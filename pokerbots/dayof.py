"""Day-of checklist: from a new GameSpec to a verified bot in a few minutes.

    1. Add the announced rules as a GameSpec in engine/variants.py (copy the closest
       existing variant; see the TEMPLATE at the bottom of this file) and add it to
       the VARIANTS tuple.
    2. python3 dayof.py --variant <name>                 # ~3-5 minutes, prints GO / NO-GO
       python3 dayof.py --variant <name> --train 15      # also trains preflop CFR (15 min) in the background

Steps:
  A. RULES SUMMARY in plain words + two narrated sample hands: read them against the
     announcement (blind order, who discards first, hand usage, stacks). Most day-of
     bugs are mapping bugs, which no test can catch except a human reading this.
  B. HAND-RANKING SANITY: category frequencies over random showdowns, printed in the
     spec's ranking order. A higher category should usually be rarer.
  C. CONFORMANCE: every bot asked for, vs random-legal and vs itself, both seats.
  D. TIMING vs the spec's per-decision limit and match clock (with 2x headroom).
  E. STRENGTH SANITY: duplicate pairs vs equity / station / push. The main bot must
     beat all three; if not, something in the mapping is wrong.
"""
from __future__ import annotations

import argparse
import math
import os
import subprocess
import sys
import time

import numpy as np

os.environ.setdefault("OMP_NUM_THREADS", "1")
ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

from engine.cards import cards_str  # noqa: E402
from engine.evaluator import get_evaluator  # noqa: E402
from engine.match import play_match  # noqa: E402
from engine.variants import get_variant  # noqa: E402

POS = {0: "SB/button", 1: "BB"}


def rules_summary(spec) -> str:
    st = ["preflop", "flop", "turn", "river"] + [f"street{i}" for i in range(4, 10)]
    lines = [f"Variant {spec.name}: {spec.notes}",
             f"  deck: {len(spec.deck)} cards (ranks {''.join('23456789TJQKA'[r] for r in sorted(spec.deck_ranks))})",
             f"  hole cards: {spec.hole_cards}; at showdown use "
             + ("ANY 5 of hole+board" if spec.hole_usage == "any" else f"EXACTLY {spec.hole_exact} hole + {5 - spec.hole_exact} board"),
             "  board: " + ", ".join(f"{st[i]} +{n}" for i, n in enumerate(spec.board_cards_per_street))]
    for d in spec.discards:
        who = "BB first, then SB" if d.order == "oop_first" else "SB first, then BB"
        dest = "face UP onto the BOARD (both may use it)" if d.to_board else (
            "to the muck face " + ("up" if d.face_up else "DOWN"))
        lines.append(f"  discard: at the start of the {st[d.street]} (after its cards are dealt, before betting), "
                     f"each player discards {d.count}, {who}, {dest}")
    lines += [f"  final: {spec.final_hole_cards} hole + {spec.final_board_cards} board cards",
              f"  ranking low->high: {' < '.join(spec.category_order)}"
              + ("" if spec.ace_low_straight else "  (no ace-low straight)"),
              f"  blinds {spec.small_blind}/{spec.big_blind} ante {spec.ante}; stack {spec.starting_stack} "
              f"({spec.stack_bb:g} bb), {'reset every hand' if spec.stack_reset_per_hand else 'NOT reset (carries over)'}; "
              f"{spec.betting.replace('_', '-')}",
              f"  SB = button acts first preflop, BB acts first after the flop; positions alternate each hand",
              f"  {spec.hands_per_match} hands per match; time per decision "
              f"{spec.time_per_decision or 'unlimited'} s, match clock {spec.time_per_match or 'unlimited'} s"]
    return "\n".join(lines)


def narrated_hands(spec, n=2, seed=4) -> str:
    from engine.game import Call, Check, Discard, HandState, RaiseTo
    from engine.match import deal_order
    ev = get_evaluator(spec)
    out = []

    def passive(p, o):  # min-bets the flop, otherwise check/call: every hand reaches showdown
        lg = o.legal
        if lg.discard_count:
            return Discard(o.my_cards[-lg.discard_count:])
        if o.street == 1 and lg.can_raise and lg.can_check and p == 1:
            return RaiseTo(lg.min_raise_to)
        return Check() if lg.can_check else Call()

    for i in range(n):
        h = HandState(spec, deal_order(spec, seed, i))
        start_hole = [list(h.hole[0]), list(h.hole[1])]
        d = h.play(passive)
        out.append(f"  hand {i}: SB {cards_str(start_hole[0])} | BB {cards_str(start_hole[1])}")
        street = -1
        for (p, s, kind, amt, cards, fu) in h.history:
            if s != street:
                street = s
                out.append(f"    -- street {s}")
            what = kind + (f" to {amt}" if kind == "raise" else f" {amt}" if kind == "call" else "")
            if kind == "discard":
                what += f" {cards_str(cards)} ({'face up' if fu else 'face down'})"
            out.append(f"       {POS[p]:9s} {what}")
        out.append(f"    board {cards_str(h.board)}")
        if h.showdown:
            for p in (0, 1):
                out.append(f"    {POS[p]:9s} shows {cards_str(h.hole[p])}: {ev.category(h.scores[p])}")
        out.append(f"    result: SB {d[0]:+d}, BB {d[1]:+d} chips")
    return "\n".join(out)


def ranking_sanity(spec, n=20000, seed=1) -> tuple[str, bool]:
    ev = get_evaluator(spec)
    rng = np.random.default_rng(seed)
    deck = np.array(spec.deck)
    k = spec.final_hole_cards + spec.final_board_cards
    idx = np.argsort(rng.random((n, len(deck))), axis=1)[:, :k]
    cards = deck[idx]
    s = ev.evaluate_batch(cards[:, :spec.final_hole_cards], cards[:, spec.final_hole_cards:])
    cats = np.array([ev.category(x) for x in s])
    lines, freqs = [], []
    for c in spec.category_order:
        f = float((cats == c).mean())
        freqs.append(f)
        lines.append(f"    {c:15s} {100 * f:6.2f}%")
    inversions = [(spec.category_order[i], spec.category_order[i + 1])
                  for i in range(len(freqs) - 1) if freqs[i + 1] > freqs[i] * 1.5 and i >= 3]
    note = ""
    if inversions:
        note = ("\n    note: a higher category is more common than a lower one: " + ", ".join(f"{a}<{b}" for a, b in inversions)
                + "  (normal for some variants, e.g. many-card games; check the ranking order against the rules)")
    return "\n".join(lines) + note, True


def strength(bot, spec, opps=("equity", "station", "push"), pairs=2, hands=300):
    from experiments.common import make_bot
    res = {}
    for o in opps:
        units = []
        for k in range(pairs):
            tot = 0
            for seat in (0, 1):
                a, b = make_bot(bot), make_bot(o)
                pair = (a, b) if seat == 0 else (b, a)
                r = play_match(pair[0], pair[1], spec, deal_seed=90_000 + k, hands=hands)
                tot += r.total if seat == 0 else -r.total
            units.append(tot / spec.big_blind / (2 * hands))
        m = float(np.mean(units))
        se = float(np.std(units, ddof=1) / math.sqrt(len(units))) if len(units) > 1 else float("nan")
        res[o] = (m, se)
    return res


def main(argv=None):
    from engine.conformance import check_bot
    from experiments.common import make_bot
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--variant", required=True)
    ap.add_argument("--bots", default="balanced,equity", help="bots to conformance-check; the first is the main bot")
    ap.add_argument("--hands", type=int, default=60, help="conformance hands per match")
    ap.add_argument("--pairs", type=int, default=2)
    ap.add_argument("--strength-hands", type=int, default=300)
    ap.add_argument("--train", type=int, default=0, help="minutes of preflop-CFR training to start in the background")
    ap.add_argument("--train-full", type=int, default=0, help="minutes of full-game CFR training to start in the background")
    ap.add_argument("--quick", action="store_true", help="skip the strength check")
    a = ap.parse_args(argv)
    t_start = time.time()
    spec = get_variant(a.variant)
    ok = True
    print("=" * 78)
    print("A. RULES SUMMARY  (read against the announcement!)")
    print(rules_summary(spec))
    print("\n  sample hands (call-down play; check order of action, discards, board, winner):")
    print(narrated_hands(spec))
    procs = []
    for kind, mins in (("preflop", a.train), ("full", a.train_full)):
        if mins:
            mod = "bots.cfr_preflop.train" if kind == "preflop" else "bots.cfr_full.train"
            cps = ",".join(str(x) for x in sorted({m for m in (5, 15, mins) if m <= mins}))
            log = open(os.path.join(ROOT, f"dayof_train_{kind}_{spec.name}.log"), "w")
            procs.append(subprocess.Popen([sys.executable, "-m", mod, "--variant", spec.name, "--minutes", str(mins),
                                           "--checkpoints", cps, "--out", "cache/cfr/"], cwd=ROOT, stdout=log,
                                          stderr=subprocess.STDOUT))
            print(f"\n  started {kind} CFR training: {mins} min (checkpoints {cps}), log dayof_train_{kind}_{spec.name}.log")

    print("\nB. HAND-RANKING SANITY (frequency of final hand categories, random cards)")
    txt, _ = ranking_sanity(spec)
    print(txt)

    print("\nC+D. CONFORMANCE + TIMING")
    bots = a.bots.split(",")
    lim = spec.time_per_decision
    for b in bots:
        t0 = time.time()
        probs = check_bot(lambda: make_bot(b), specs=[spec], hands=a.hands, verbose=False,
                          limit=(lim / 2) if lim else 2.0)
        # timing summary from one dedicated match vs random_legal
        r = play_match(make_bot(b), make_bot("random_legal"), spec, deal_seed=5, hands=100)
        st = r.stats[0].summary()
        dph = r.stats[0].decisions / max(1, r.hands_played)
        proj = st["mean_ms"] * dph * spec.hands_per_match / 1000
        clock = spec.time_per_match
        verdict = "OK" if not probs else "FAIL"
        probe = make_bot(b)
        probe.new_match(spec, 0)
        inner = probe
        while inner is not None and not getattr(inner, "using_fallback", False):
            inner = getattr(inner, "inner", None)
        if inner is not None and not probs:
            verdict = "OK but NO POLICY (playing its fallback; train it or use another bot)"
        if clock and proj > clock / 2:
            verdict = "FAIL (projected match time over half the clock)"
            probs.append("clock")
        print(f"  {b:16s} {verdict:6s} mean {st['mean_ms']:.1f} ms  max {st['max_ms']:.0f} ms  "
              f"~{proj:.0f} s per {spec.hands_per_match}-hand match  ({time.time() - t0:.0f}s)")
        for p in probs[:5]:
            print("     ", str(p)[:300])
        if b == bots[0] and probs:
            ok = False

    if not a.quick:
        print(f"\nE. STRENGTH SANITY  ({bots[0]}, {a.pairs} duplicate pairs x {a.strength_hands} hands, bb/hand ± se)")
        res = strength(bots[0], spec, pairs=a.pairs, hands=a.strength_hands)
        for o, (m, se) in res.items():
            flag = "ok" if m > 0 else "SUSPICIOUS: should beat this opponent"
            if m <= 0 and o != "equity":
                ok = False
            print(f"  vs {o:8s} {m:+.2f} ± {se:.2f}   {flag}")

    for p in procs:
        print(f"\n  CFR training still running (pid {p.pid}); load it with make_bot('preflop_cfr', budget='{a.train}m') "
              f"when the checkpoint appears in cache/cfr/")
    print("\n" + ("GO" if ok else "NO-GO: fix the failures above") + f"   (checks took {time.time() - t_start:.0f}s)")
    return 0 if ok else 1


TEMPLATE = '''
DAY = GameSpec(
    name="day",                      # used for CFR policy file names
    deck_ranks=tuple(range(13)),     # short deck 6+: tuple(range(4, 13))
    hole_cards=2,
    hole_usage="any",                # or "exactly" with hole_exact=2 (Omaha)
    hole_exact=2,
    board_cards_per_street=(0, 3, 1, 1),
    discards=(),                     # e.g. (DiscardRule(street=1, count=1, to_board=True, face_up=True, order="oop_first"),)
    category_order=STANDARD_ORDER,   # SHORT_DECK_ORDER for short deck
    small_blind=1, big_blind=2, ante=0,
    starting_stack=200, stack_reset_per_hand=True,
    hands_per_match=1000, betting="no_limit",
    time_per_decision=None, time_per_match=None,
    notes="what the organisers said, verbatim",
)
'''

if __name__ == "__main__":
    sys.exit(main())
