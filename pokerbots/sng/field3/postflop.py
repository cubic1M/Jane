"""Postflop helpers: a cheap made-hand / draw classifier and a small vectorised
Monte Carlo equity (random opponent hands)."""
from __future__ import annotations

from collections import Counter
from typing import NamedTuple

import numpy as np


class HandInfo(NamedTuple):
    level: int          # 0 nothing / board, 1 weak pair, 2 middle or weak top pair,
                        # 3 good top pair / overpair, 4 two pair / trips, 5 straight+ or set
    cat: str            # evaluator category name of my best hand
    outs: int           # rough clean outs to a strong hand (0 on the river)
    flush_draw: bool
    straight_draw: bool  # open-ended (or double gutter)


def _straight_windows(deck_ranks):
    ranks = sorted(deck_ranks)
    wins = []
    for i in range(len(ranks) - 4):
        w = ranks[i:i + 5]
        if w[-1] - w[0] == 4:
            wins.append(frozenset(w))
    if 12 in ranks and len(ranks) >= 5:
        wins.append(frozenset([12] + ranks[:4]))
    return wins


_WIN_CACHE: dict = {}


def windows_for(spec):
    k = tuple(spec.deck_ranks)
    w = _WIN_CACHE.get(k)
    if w is None:
        w = _WIN_CACHE[k] = _straight_windows(k)
    return w


def board_category(board, spec) -> str:
    ranks = [c >> 2 for c in board]
    cnt = sorted(Counter(ranks).values(), reverse=True)
    if len(board) >= 5:
        suits = Counter(c & 3 for c in board)
        flush = max(suits.values()) >= 5
        rs = set(ranks)
        straight = any(w <= rs for w in windows_for(spec))
        if flush and straight:
            return "straight_flush"
    else:
        flush = straight = False
    if cnt[0] == 4:
        return "quads"
    made = "high_card"
    if cnt[0] == 3 and len(cnt) > 1 and cnt[1] >= 2:
        made = "full_house"
    elif cnt[0] == 3:
        made = "trips"
    elif cnt[0] == 2 and len(cnt) > 1 and cnt[1] == 2:
        made = "two_pair"
    elif cnt[0] == 2:
        made = "pair"
    order = spec.category_order
    best = made
    for alt, ok in (("flush", flush), ("straight", straight)):
        if ok and order.index(alt) > order.index(best):
            best = alt
    return best


def hand_info(hole, board, ev, spec) -> HandInfo:
    score = ev.evaluate(hole, board)
    cat = ev.category(score)
    order = spec.category_order
    bcat = board_category(board, spec)
    improved = order.index(cat) > order.index(bcat)
    hr = [c >> 2 for c in hole]
    br = sorted((c >> 2 for c in board), reverse=True)
    top = br[0]
    bcount = Counter(br)
    level = 0
    if improved:
        if cat in ("straight", "flush", "full_house", "quads", "straight_flush"):
            level = 5
        elif cat == "trips":
            set_made = any(hr.count(r) >= 2 and bcount[r] >= 1 for r in set(hr))
            level = 5 if set_made else 4
        elif cat == "two_pair":
            paired = [r for r in set(hr) if bcount[r] >= 1]
            if len(paired) >= 2 and max(bcount.values()) == 1:
                level = 4
            elif any(hr.count(r) >= 2 and r > top for r in set(hr)):
                level = 3                       # overpair on a paired board
            elif paired and max(paired) == top:
                level = 3
            else:
                level = 2 if paired else 1
        elif cat == "pair":
            pocket = [r for r in set(hr) if hr.count(r) >= 2]
            if pocket and max(pocket) > top:
                level = 3
            else:
                p = max([r for r in set(hr) if bcount[r] >= 1] + pocket, default=-1)
                if p == top:
                    kick = max([r for r in hr if r != p], default=0)
                    level = 3 if (kick >= 8 or p == 12) else 2
                elif len(br) > 1 and p >= br[1]:
                    level = 2
                else:
                    level = 1
    outs = 0
    fd = sd = False
    if len(board) < spec.total_board_dealt and level < 5:
        hs = Counter(c & 3 for c in hole)
        bs = Counter(c & 3 for c in board)
        for s, k in hs.items():
            if spec.hole_usage == "exactly":
                if k >= 2 and bs.get(s, 0) == 2:      # two suited hole cards + one more board card
                    fd = True
            elif k + bs.get(s, 0) == 4:
                fd = True
        allr = set(hr) | set(br)
        hset = set(hr)
        n4 = 0
        for w in windows_for(spec):
            have = w & allr
            if len(have) == 4 and (w - set(br)) & hset:
                n4 += 1
        if n4 >= 2:
            sd = True
        outs = (9 if fd else 0) + (8 if sd else (4 if n4 == 1 else 0))
        outs = min(outs, 15)
    return HandInfo(level, cat, outs, fd, sd)


def mc_equity(hole, board, n_opp: int, n: int, rng, spec, ev) -> float:
    """Equity (win + tie/2, ties counted as half) of hole vs n_opp random hands."""
    n_opp = max(1, int(n_opp))
    known = set(hole) | set(board)
    avail = np.array([c for c in spec.deck if c not in known], dtype=np.int64)
    h = spec.hole_cards
    nb = spec.total_board_dealt - len(board)
    n_opp = min(n_opp, (len(avail) - nb) // h)
    m = n_opp * h + nb
    idx = np.argpartition(rng.random((n, len(avail))), m - 1, axis=1)[:, :m]
    draw = avail[idx]
    bd = np.asarray(board, dtype=np.int64)
    boards = np.concatenate([np.broadcast_to(bd, (n, len(bd))), draw[:, :nb]], axis=1)
    holes = np.concatenate([np.broadcast_to(np.asarray(hole, dtype=np.int64), (n, h)),
                            draw[:, nb:].reshape(n * n_opp, h)], axis=0)
    allb = np.concatenate([boards, np.repeat(boards, n_opp, axis=0)], axis=0)
    sc = ev.evaluate_batch(holes, allb)
    mine = sc[:n]
    best = sc[n:].reshape(n, n_opp).max(axis=1)
    return float(((mine > best) + 0.5 * (mine == best)).mean())


def mc_samples(spec, n: int) -> int:
    """Scale a sample count down for the slower 'exactly k hole cards' evaluation."""
    if spec.hole_usage == "exactly":
        return max(6, n // 8)
    return n
