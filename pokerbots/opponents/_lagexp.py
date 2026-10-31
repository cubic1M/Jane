"""Shared, spec-driven helpers for opp_lag (lag.py) and opp_exploit (exploiter.py).

Everything here reads the rules from the GameSpec / Observation; nothing is
hard-coded to hold'em. Monte Carlo sample counts are sized from
EquityModel.ms_per_sample() so a decision stays inside a time budget on every
variant (Omaha-style specs are ~6-10x costlier per sample).
"""
from __future__ import annotations

from itertools import combinations

import numpy as np

from engine.equity import get_equity_model
from engine.evaluator import get_evaluator
from engine.game import CALL, DISCARD, RAISE, Discard, RaiseTo

# ---------------------------------------------------------------------------
# Preflop strength
# ---------------------------------------------------------------------------
_PCT_DIST: dict = {}   # spec -> sorted preflop equities of random hands


def heuristic_strength(holes) -> np.ndarray:
    """Cheap vectorised preflop quality score for (m, h) hole-card arrays:
    best two-card combination (high cards, pairs, suited, connected) plus a
    smaller credit for the second best, so it works for 1..5 hole cards."""
    holes = np.asarray(holes, dtype=np.int64)
    m, h = holes.shape
    if h == 1:
        return (holes[:, 0] >> 2).astype(float)
    r = holes >> 2
    s = holes & 3
    scores = []
    for i, j in combinations(range(h), 2):
        hi = np.maximum(r[:, i], r[:, j]).astype(float)
        lo = np.minimum(r[:, i], r[:, j]).astype(float)
        pair = r[:, i] == r[:, j]
        sc = hi + 0.55 * lo
        sc = sc + np.where(pair, 7.0 + 0.5 * lo, 0.0)
        sc = sc + np.where(s[:, i] == s[:, j], 2.0, 0.0)
        sc = sc - np.where(pair, 0.0, np.clip(hi - lo - 1, 0, 4) * 0.7)
        scores.append(sc)
    S = np.sort(np.stack(scores, axis=1), axis=1)
    out = S[:, -1]
    if S.shape[1] > 1:
        out = out + 0.25 * S[:, -2]
    return out


def preflop_n(spec) -> int:
    ms = get_equity_model(spec).ms_per_sample()
    return int(np.clip(2.5 / max(ms, 1e-4), 60, 500))


def warm_up(spec, samples: int = 120) -> None:
    """Build evaluator tables, time the equity model and the preflop-equity
    distribution for this spec (once per process). Called from new_match so
    no single decision pays for it."""
    m = get_equity_model(spec)
    m.ms_per_sample()
    if spec in _PCT_DIST:
        return
    rng = np.random.default_rng(12345)
    deck = np.array(spec.deck)
    n = preflop_n(spec)
    eqs = [m.preflop_equity(tuple(int(c) for c in rng.choice(deck, spec.hole_cards, replace=False)), n=n)
           for _ in range(samples)]
    _PCT_DIST[spec] = np.sort(np.array(eqs))


def preflop_pct(spec, cards) -> float:
    """Percentile (0 = worst, 1 = best) of my hand's preflop equity vs random."""
    warm_up(spec)
    eq = get_equity_model(spec).preflop_equity(tuple(cards), n=preflop_n(spec))
    dist = _PCT_DIST[spec]
    return float(np.searchsorted(dist, eq)) / len(dist)


# ---------------------------------------------------------------------------
# Range-weighted Monte Carlo equity
# ---------------------------------------------------------------------------
def draw_flags(cands: np.ndarray, board: np.ndarray) -> np.ndarray:
    """True where hole+board holds 4 to a flush (using a hole card) or 4 ranks of
    a 5-rank straight window."""
    m = cands.shape[0]
    allc = np.concatenate([cands, np.broadcast_to(board, (m, len(board)))], axis=1)
    suits = allc & 3
    fd = np.zeros(m, dtype=bool)
    for su in range(4):
        fd |= ((suits == su).sum(axis=1) == 4) & ((cands & 3) == su).any(axis=1)
    mask = np.zeros(m, dtype=np.int64)
    for k in range(allc.shape[1]):
        mask |= np.left_shift(1, allc[:, k] >> 2)
    ext = (mask << 1) | ((mask >> 12) & 1)  # bit 0 = ace playing low
    sd = np.zeros(m, dtype=bool)
    for w in range(10):
        win = (ext >> w) & 0x1F
        pc = sum((win >> b) & 1 for b in range(5))
        sd |= pc == 4
    return fd | sd


def make_range_sampler(spec, board, frac: float, k: int, to_come: int, noise: float = 0.08):
    """opp_sampler for EquityModel.equity: opponent holdings drawn from roughly
    the top `frac` of hands. Preflop the ranking is a card heuristic; postflop
    it is the made-hand score on the current board, with draws credited as
    medium-strength hands (so semi-bluffs stay in the range)."""
    ev = get_evaluator(spec)
    board = np.array(list(board), dtype=np.int64)
    frac = float(np.clip(frac, 0.05, 1.0))
    mult = min(4.0, 1.0 / frac)

    def sampler(n, avail, rng):
        m = int(n * mult) + 1
        keys = rng.random((m, len(avail)))
        idx = np.argpartition(keys, k - 1, axis=1)[:, :k]
        cands = avail[idx]
        key = None
        if len(board) >= 3:
            try:
                sc = ev.evaluate_batch(cands, np.broadcast_to(board, (m, len(board))))
                key = np.argsort(np.argsort(sc, kind="stable"), kind="stable") / max(1, m - 1)
                if to_come:
                    key = np.maximum(key, 0.62 * draw_flags(cands, board))
            except Exception:
                key = None
        if key is None:
            hs = heuristic_strength(cands)
            key = np.argsort(np.argsort(hs, kind="stable"), kind="stable") / max(1, m - 1)
        key = key + rng.normal(0.0, noise, m)
        top = np.argpartition(-key, n - 1)[:n]
        return cands[top]

    return sampler


def mc_n(spec, budget_ms: float, factor: float = 1.0, lo: int = 40, hi: int = 700) -> int:
    ms = get_equity_model(spec).ms_per_sample() * factor
    return int(np.clip(budget_ms / max(ms, 1e-4), lo, hi))


def equity(obs, spec, nprng, budget_ms: float = 3.0, frac: float = 1.0) -> float:
    """Equity vs an opponent range of roughly the top `frac` of holdings."""
    m = get_equity_model(spec)
    if frac >= 0.995:
        return m.equity_obs(obs, n=mc_n(spec, budget_ms), rng=nprng)
    s = make_range_sampler(spec, obs.board, frac, obs.opp_num_cards, obs.board_cards_to_come)
    factor = 1.0 + 0.5 * min(4.0, 1.0 / max(frac, 0.05))
    return m.equity_obs(obs, n=mc_n(spec, budget_ms, factor=factor), rng=nprng, opp_sampler=s)


def best_discard(obs, spec, nprng, budget_ms: float = 4.0):
    m = get_equity_model(spec)
    k = obs.legal.discard_count
    n_opts = max(1, len(list(combinations(range(len(obs.my_cards)), k))))
    n = mc_n(spec, budget_ms / n_opts, lo=30, hi=400)
    opts = m.discard_options(obs, n=n, rng=nprng)
    return Discard(opts[0][0])


# ---------------------------------------------------------------------------
# Situation helpers
# ---------------------------------------------------------------------------
def raises_on(history, street: int) -> int:
    return sum(1 for r in history if r.street == street and r.kind == RAISE)


def last_aggressor(history, street: int):
    pos = None
    for r in history:
        if r.street == street and r.kind == RAISE:
            pos = r.position
    return pos


def acted_on(history, street: int, pos: int, kind: str) -> bool:
    return any(r.street == street and r.kind == kind and r.position == pos for r in history)


def is_river(obs, spec) -> bool:
    return obs.street >= spec.num_streets - 1 and obs.board_cards_to_come == 0


def new_cards_this_street(obs, spec):
    """(cards dealt at the start of this street, board before them)."""
    start = 0
    for st in range(obs.street):
        start += spec.board_cards_per_street[st]
        for d in spec.discards_on_street(st):
            if d.to_board:
                start += 2 * d.count
    n = spec.board_cards_per_street[obs.street]
    return tuple(obs.board[start:start + n]), tuple(obs.board[:start])


def _straightness(ranks) -> int:
    rs = set(ranks)
    if 12 in rs:
        rs.add(-1)
    return max(sum(1 for x in range(lo, lo + 5) if x in rs) for lo in range(-1, 9))


def scare_card(obs, spec) -> bool:
    """True if a card dealt this street (turn onwards) is a high overcard,
    puts a third card of a suit on board, pairs the board or makes four to a
    straight possible."""
    if obs.street < 2:
        return False
    new, old = new_cards_this_street(obs, spec)
    if not new or not old:
        return False
    old_r = [c >> 2 for c in old]
    for c in new:
        r, s = c >> 2, c & 3
        if r > max(old_r) and r >= spec.deck_ranks[-1] - 3:
            return True
        if sum(1 for o in old if (o & 3) == s) >= 2:
            return True
        if r in old_r:
            return True
        if _straightness(old_r + [r]) >= 4 > _straightness(old_r):
            return True
    return False


def bet_to(obs, frac: float) -> int:
    """Legal raise-to amount for a bet (or raise) of `frac` x pot (pot after calling)."""
    lg = obs.legal
    call = lg.call_amount
    if call > 0:
        target = obs.my_pip + call + frac * (obs.pot + call)
    else:
        target = obs.my_pip + frac * obs.pot
    return lg.clamp_raise(target)


def eff_stack(obs) -> int:
    return min(obs.my_stack, obs.opp_stack)


def size_bucket(frac: float) -> int:
    """0: small (<0.45 pot), 1: medium, 2: large (~pot), 3: overbet."""
    if frac < 0.45:
        return 0
    if frac < 0.85:
        return 1
    if frac < 1.3:
        return 2
    return 3


def replay(history, spec):
    """Yield (record, pot_before, pips_before, to_call_for_actor) for every
    betting record, rebuilding pot and pips from antes and blinds."""
    pot = 2 * spec.ante + spec.small_blind + spec.big_blind
    pips = [spec.small_blind, spec.big_blind]
    street = 0
    for r in history:
        if r.street != street:
            street = r.street
            pips = [0, 0]
        if r.kind == DISCARD:
            continue
        to_call = max(0, pips[1 - r.position] - pips[r.position])
        yield r, pot, tuple(pips), to_call
        if r.kind == RAISE:
            pot += r.amount - pips[r.position]
            pips[r.position] = r.amount
        elif r.kind == CALL:
            pot += r.amount
            pips[r.position] += r.amount
