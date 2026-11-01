"""ICM push/fold equilibrium charts for the short-stack phase of 8-bot sit-and-gos.

The game solved, for each number of players left n (2..8) and effective stack depth d
(in big blinds, equal stacks for the rest of the table):
  * players act in order UTG .. button, SB; the first player who shoves goes all-in, every
    earlier player has folded;
  * after a shove, each later player may call (heads-up all-in with the shover) or fold;
    the first caller ends the action (multi-way all-ins are rare at these depths and
    ignored);
  * payoffs = ICM equity (Malmuth-Harville on the remaining point table) of the stacks after
    the hand, from heads-up all-in equities of the 169 hold'em classes.
Strategies (shove probability per class for each position; call probability per class for
each caller-vs-shover position pair) are found by fictitious play: each iteration plays a
best response to the average opponents and folds it into the average (the CFR-style
averaging that converges in such two-action games). Result: charts keyed by
(n, depth, position) -> shove threshold, and (n, depth, caller, shover) -> call threshold,
as percentile ranks of the 169 classes (sorted by heads-up strength).

    python3 -m sng.ours.pushfold --build       # equity matrix (~2 min) + charts (~minutes)
"""
from __future__ import annotations

import argparse
import itertools
import json
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "cache" / "sng"
RANKS = "23456789TJQKA"


def classes():
    """The 169 classes as (hi, lo, kind) with kind p/s/o, and their combo counts."""
    out = []
    for hi in range(12, -1, -1):
        for lo in range(hi, -1, -1):
            if hi == lo:
                out.append((hi, lo, "p"))
            else:
                out.append((hi, lo, "s"))
                out.append((hi, lo, "o"))
    w = np.array([6 if k == "p" else 4 if k == "s" else 12 for _, _, k in out], dtype=float)
    return out, w / w.sum()


CLS, WEIGHT = classes()
INDEX = {c: i for i, c in enumerate(CLS)}


def class_of(hole) -> int:
    a, b = sorted(hole, key=lambda c: -(c >> 2))
    ra, rb = a >> 2, b >> 2
    if ra == rb:
        return INDEX[(ra, rb, "p")]
    return INDEX[(ra, rb, "s" if (a & 3) == (b & 3) else "o")]


def class_index_array(h):
    """Vectorised class index for (B, 2) card arrays."""
    r = h >> 2
    su = h & 3
    hi = np.maximum(r[:, 0], r[:, 1])
    lo = np.minimum(r[:, 0], r[:, 1])
    kind = np.where(hi == lo, 0, np.where(su[:, 0] == su[:, 1], 1, 2))
    return _LUT[hi, lo, kind]


_LUT = np.zeros((13, 13, 3), dtype=np.int64)
for _i, (_h, _l, _k) in enumerate(CLS):
    _LUT[_h, _l, {"p": 0, "s": 1, "o": 2}[_k]] = _i


def equity_matrix(seconds=120.0, seed=0, chunk=200_000):
    """E[i, j] = all-in equity of class i vs class j (ties split), by bulk Monte Carlo:
    random heads-up deals accumulated by class pair (card removal is exact)."""
    from engine.evaluator import get_evaluator
    from sng.rules import NLHE
    ev = get_evaluator(NLHE)
    rng = np.random.default_rng(seed)
    n = len(CLS)
    win = np.zeros((n, n))
    cnt = np.zeros((n, n))
    t_end = time.time() + seconds
    deals = 0
    while time.time() < t_end:
        keys = rng.random((chunk, 52))
        cards = np.argsort(keys, axis=1)[:, :9]
        a_h, b_h, board = cards[:, 0:2], cards[:, 2:4], cards[:, 4:9]
        sa = ev.evaluate_batch(a_h, board)
        sb = ev.evaluate_batch(b_h, board)
        ia, ib = class_index_array(a_h), class_index_array(b_h)
        res = (sa > sb) + 0.5 * (sa == sb)
        np.add.at(win, (ia, ib), res)
        np.add.at(cnt, (ia, ib), 1)
        deals += chunk
    W = win + (cnt - win).T          # symmetric use of every deal
    C = cnt + cnt.T
    E = np.where(C > 0, W / np.maximum(C, 1), 0.5)
    return E, int(C.min()), deals


# ---- solver ------------------------------------------------------------------------------
def _icm_vec(stacks, pay):
    """ICM points for every player; zero stacks get the lowest remaining places in order
    of elimination (all busted players of one hand share them equally)."""
    from sng.icm import icm
    n = len(stacks)
    alive = [i for i in range(n) if stacks[i] > 1e-9]
    dead = [i for i in range(n) if stacks[i] <= 1e-9]
    out = [0.0] * n
    ev = icm([stacks[i] for i in alive], pay[:len(alive)])
    for i, e in zip(alive, ev):
        out[i] = e
    if dead:
        share = sum(pay[len(alive):n]) / len(dead)
        for i in dead:
            out[i] = share
    return out


def solve(n, d, pay, ante=0.0, iters=300):
    """Push/fold equilibrium for n players with equal stacks of d big blinds. Action order
    0..n-1: 0 = UTG ... n-2 = SB, n-1 = BB (heads-up: 0 = SB/button, 1 = BB).
    Returns (shove[p] -> 169 probs, call[(q, p)] -> 169 probs)."""
    E = _E()
    w = WEIGHT
    sb_pos, bb_pos = n - 2, n - 1
    blind = [0.0] * n
    blind[sb_pos] += 0.5
    blind[bb_pos] += 1.0
    stack0 = [d] * n
    dead = n * ante
    # outcome ICM vectors
    def after(changes):
        st = [stack0[i] - ante - blind[i] for i in range(n)]
        for i, v in changes.items():
            st[i] += v
        return _icm_vec(st, pay)
    pot0 = 1.5 + dead
    walk = after({bb_pos: pot0})                                   # everyone folds to the BB
    steal = {p: after({p: pot0}) for p in range(n - 1)}            # p shoves, all fold
    win, lose = {}, {}
    for p in range(n - 1):
        for q in range(p + 1, n):
            # both all-in for d; p wins / q wins the whole pot (2d + dead money of others)
            others = pot0 - blind[p] - blind[q] - 0.0
            win[(p, q)] = after({p: d - ante + others + (d - ante), q: -(d - ante - blind[q]) - blind[q] + blind[q]})
            lose[(p, q)] = after({q: d - ante + others + (d - ante), p: -(d - ante - blind[p]) - blind[p] + blind[p]})
    # fix the loser stacks to exactly zero (all-in for the whole stack) and recompute cleanly
    for (p, q) in list(win):
        st = [stack0[i] - ante - blind[i] for i in range(n)]
        pot = 2 * (d - ante) + sum(blind[i] for i in range(n) if i not in (p, q)) + dead
        stw, stl = st[:], st[:]
        stw[p], stw[q] = pot, 0.0
        stl[p], stl[q] = 0.0, pot
        win[(p, q)], lose[(p, q)] = _icm_vec(stw, pay), _icm_vec(stl, pay)

    shove = {p: np.full(169, 0.5) for p in range(n - 1)}
    call = {(q, p): np.full(169, 0.5) for p in range(n - 1) for q in range(p + 1, n)}

    def probs():
        s = {p: float(w @ shove[p]) for p in shove}
        k = {qp: float(w @ call[qp]) for qp in call}
        return s, k

    def cont_after_shove(p, frm, s, k, who):
        """Expected ICM of player `who` once p has shoved and players before `frm` (after p)
        have folded: later players may call (first caller ends the action)."""
        ev = 0.0
        reach = 1.0
        for q in range(frm, n):
            kq = k[(q, p)]
            if kq > 0:
                # p's win prob vs q's calling range given p's shoving range
                rng_p = w * shove[p]
                rng_q = w * call[(q, p)]
                denom = rng_p.sum() * rng_q.sum()
                pw = float(rng_p @ E @ rng_q / denom) if denom > 0 else 0.5
                ev += reach * kq * (pw * win[(p, q)][who] + (1 - pw) * lose[(p, q)][who])
            reach *= 1 - kq
        return ev + reach * steal[p][who]

    def cont_from(frm, s, k, who):
        """Expected ICM of `who` when players before `frm` folded first-in."""
        ev, reach = 0.0, 1.0
        for r in range(frm, n - 1):
            if s[r] > 0:
                ev += reach * s[r] * cont_after_shove(r, r + 1, s, k, who)
            reach *= 1 - s[r]
        return ev + reach * walk[who]

    for t in range(iters):
        s, k = probs()
        a = 1.0 / (t + 2)
        new_shove, new_call = {}, {}
        for p in range(n - 1):
            ev_fold = cont_from(p + 1, s, k, p)
            # shove EV per class: vs each later caller's range
            ev_sh = np.zeros(169)
            reach = 1.0
            for q in range(p + 1, n):
                kq = k[(q, p)]
                rng_q = w * call[(q, p)]
                if kq > 0 and rng_q.sum() > 0:
                    eq = E @ rng_q / rng_q.sum()                    # my class vs q's calling range
                    ev_sh += reach * kq * (eq * win[(p, q)][p] + (1 - eq) * lose[(p, q)][p])
                reach *= 1 - kq
            ev_sh += reach * steal[p][p]
            new_shove[p] = (ev_sh > ev_fold).astype(float)
            for q in range(p + 1, n):
                rng_p = w * shove[p]
                if rng_p.sum() <= 0:
                    new_call[(q, p)] = call[(q, p)]
                    continue
                eq = 1.0 - (rng_p @ E) / rng_p.sum()               # my class vs p's shoving range
                ev_call = eq * lose[(p, q)][q] + (1 - eq) * win[(p, q)][q]
                ev_fold_q = cont_after_shove(p, q + 1, s, k, q)
                new_call[(q, p)] = (ev_call > ev_fold_q).astype(float)
        for p in shove:
            shove[p] = (1 - a) * shove[p] + a * new_shove[p]
        for qp in call:
            call[qp] = (1 - a) * call[qp] + a * new_call[qp]
    return shove, call


_EM = {}


def _E():
    if "E" not in _EM:
        _EM["E"] = np.load(CACHE / "pushfold_equity.npy")
    return _EM["E"]


DEPTHS = (2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20)


def build_charts(pay, ante=0.0, iters=200, players=range(2, 9), depths=DEPTHS):
    charts = {"pay": list(pay), "ante": ante, "depths": list(depths), "shove": {}, "call": {}}
    for n in players:
        for d in depths:
            sh, ca = solve(n, d, pay[:n], ante, iters)
            for p, v in sh.items():
                charts["shove"][f"{n},{d},{p}"] = "".join("1" if x > 0.5 else "0" for x in v)
            for (q, p), v in ca.items():
                charts["call"][f"{n},{d},{q},{p}"] = "".join("1" if x > 0.5 else "0" for x in v)
    return charts


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--matrix-seconds", type=float, default=300)
    ap.add_argument("--iters", type=int, default=200)
    ap.add_argument("--payouts", default="synthetic")
    ap.add_argument("--skip-matrix", action="store_true")
    a = ap.parse_args(argv)
    from sng.rules import PAYOUT_SETS
    CACHE.mkdir(parents=True, exist_ok=True)
    if not a.skip_matrix or not (CACHE / "pushfold_equity.npy").exists():
        t0 = time.time()
        E, mn, deals = equity_matrix(a.matrix_seconds)
        np.save(CACHE / "pushfold_equity.npy", E)
        print(f"equity matrix: {deals} deals, min {mn} samples per pair, {time.time() - t0:.0f}s", flush=True)
    t0 = time.time()
    ch = build_charts(PAYOUT_SETS[a.payouts], iters=a.iters)
    out = CACHE / f"pushfold_{a.payouts}.json"
    out.write_text(json.dumps(ch))
    print(f"charts {out.name}: {len(ch['shove'])} shove + {len(ch['call'])} call, {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
