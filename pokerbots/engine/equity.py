"""Spec-aware Monte Carlo equity, shared by all bots.

Model (an approximation, documented in REPORT.md):
  * Opponent hole cards are uniform over unseen cards unless an opp_sampler is given.
  * Future board cards are uniform over the rest.
  * Future discards to the BOARD: the discarded card is uniform from that player's
    hand (the discarder's own pool of usable cards does not change).
  * Future discards to the MUCK: each player keeps the subset that is best on the
    final board ("hindsight"); the bias is symmetric for both players.
Equity = P(win) + 0.5 P(tie).
"""
from __future__ import annotations

from itertools import combinations, permutations
from typing import Callable, Optional

import numpy as np

from .evaluator import get_evaluator
from .game import Observation
from .spec import GameSpec


def canonical(cards) -> tuple:
    """Suit-isomorphic canonical form of a set of cards (e.g. 169 classes for 2 cards)."""
    best = None
    for perm in permutations(range(4)):
        t = tuple(sorted((((c >> 2) << 2) | perm[c & 3]) for c in cards))
        if best is None or t < best:
            best = t
    return best


class EquityModel:
    def __init__(self, spec: GameSpec):
        self.spec = spec
        self.ev = get_evaluator(spec)
        self.deck = np.array(spec.deck, dtype=np.int64)
        self._pre_cache: dict = {}

    def _future_to_board(self, street: int, include_current: bool = True) -> bool:
        """to_board of the next discard rule. include_current=False in a betting phase:
        that street's discards are already done."""
        nxt = [d for d in self.spec.discards
               if d.street > street or (include_current and d.street == street)]
        return min(nxt, key=lambda d: d.street).to_board if nxt else True

    def equity(self, my_cards, board, *, opp_num_cards: int, board_to_come: int,
               my_discards_left: int = 0, opp_discards_left: int = 0, discard_to_board: bool = True,
               dead=(), n: int = 200, rng: Optional[np.random.Generator] = None,
               opp_sampler: Optional[Callable] = None) -> float:
        """MC equity of my_cards vs one opponent. dead = cards known not to be live
        (e.g. my mucked discards, opponent's face-up mucked discards)."""
        rng = rng if rng is not None else np.random.default_rng()
        my = np.array(list(my_cards), dtype=np.int64)
        bd = np.array(list(board), dtype=np.int64)
        known = set(int(c) for c in my_cards) | set(int(c) for c in board) | set(int(c) for c in dead)
        avail = np.array([c for c in self.deck if int(c) not in known], dtype=np.int64)
        A = len(avail)
        if opp_sampler is not None:
            keys = rng.random((n, A))
            opp = np.asarray(opp_sampler(n, avail, rng), dtype=np.int64)  # (n, opp_num_cards)
            # exclude opponent's cards from the board draw (avail is sorted)
            pos = np.searchsorted(avail, opp)
            np.put_along_axis(keys, pos, 2.0, axis=1)
            order = np.argsort(keys, axis=1)
            fut = avail[order[:, :board_to_come]]
        else:
            # keys over the FULL deck (known cards masked) so that calls differing in a
            # card or two draw nearly the same samples from the same seed (common
            # random numbers for comparing options)
            k = opp_num_cards + board_to_come
            keys = rng.random((n, len(self.deck)))
            keys[:, np.isin(self.deck, np.fromiter(known, dtype=np.int64, count=len(known)))] = 2.0
            idx = np.argpartition(keys, k - 1, axis=1)[:, :k]
            idx = np.take_along_axis(idx, np.argsort(np.take_along_axis(keys, idx, axis=1), axis=1), axis=1)
            drawn = self.deck[idx]
            opp = drawn[:, :opp_num_cards]
            fut = drawn[:, opp_num_cards:k]
        myb = np.broadcast_to(my, (n, len(my)))
        bdb = np.broadcast_to(bd, (n, len(bd)))
        final_board = np.concatenate([bdb, fut], axis=1)
        if (my_discards_left or opp_discards_left) and discard_to_board:
            extra = []
            my_keep, opp_keep = myb, opp
            if my_discards_left:
                idx = np.argsort(rng.random((n, len(my))), axis=1)
                d = np.take_along_axis(myb, idx, axis=1)
                extra.append(d[:, :my_discards_left])
                my_keep = d[:, my_discards_left:]
            if opp_discards_left:
                idx = np.argsort(rng.random((n, opp.shape[1])), axis=1)
                d = np.take_along_axis(opp, idx, axis=1)
                extra.append(d[:, :opp_discards_left])
                opp_keep = d[:, opp_discards_left:]
            final_board = np.concatenate([final_board] + extra, axis=1)
            s_me = self.ev.evaluate_batch(my_keep, final_board)
            s_op = self.ev.evaluate_batch(opp_keep, final_board)
        else:
            s_me = self._best_keep(myb, final_board, my_discards_left)
            s_op = self._best_keep(opp, final_board, opp_discards_left)
        return float(np.mean((s_me > s_op) + 0.5 * (s_me == s_op)))

    def _best_keep(self, hole: np.ndarray, board: np.ndarray, n_discard: int) -> np.ndarray:
        if n_discard == 0:
            return self.ev.evaluate_batch(hole, board)
        h = hole.shape[1]
        best = None
        for keep in combinations(range(h), h - n_discard):
            s = self.ev.evaluate_batch(hole[:, list(keep)], board)
            best = s if best is None else np.maximum(best, s)
        return best

    # ---- conveniences -------------------------------------------------------------
    def dead_cards(self, obs: Observation) -> tuple:
        on_board = set(obs.board)
        return tuple(c for c in tuple(obs.my_discards) + tuple(obs.opp_discards) if c not in on_board)

    def equity_obs(self, obs: Observation, n: int = 200, rng=None, opp_sampler=None,
                   my_cards=None, extra_board=()) -> float:
        """Equity from an observation. my_cards/extra_board let a bot evaluate a
        hypothetical (e.g. a discard choice)."""
        mine = tuple(obs.my_cards) if my_cards is None else tuple(my_cards)
        my_left = obs.my_discards_left if my_cards is None else max(
            0, obs.my_discards_left - (len(obs.my_cards) - len(mine)))
        return self.equity(mine, tuple(obs.board) + tuple(extra_board),
                           opp_num_cards=obs.opp_num_cards, board_to_come=obs.board_cards_to_come,
                           my_discards_left=my_left, opp_discards_left=obs.opp_discards_left,
                           discard_to_board=self._future_to_board(obs.street, obs.phase == "discard"),
                           dead=self.dead_cards(obs) + tuple(c for c in obs.my_cards if c not in mine and c not in extra_board),
                           n=n, rng=rng, opp_sampler=opp_sampler)

    def discard_options(self, obs: Observation, n: int = 150, rng=None) -> list:
        """For a discard decision: [(cards_to_discard, equity_after), ...] best first."""
        k = obs.legal.discard_count
        rule = next(d for d in self.spec.discards if d.street == obs.street)
        # common random numbers: every option sees the same sample stream, so the
        # comparison between options is far less noisy than the absolute values
        base = int((rng if rng is not None else np.random.default_rng()).integers(2 ** 62))
        out = []
        for disc in combinations(obs.my_cards, k):
            keep = tuple(c for c in obs.my_cards if c not in disc)
            extra = disc if rule.to_board else ()
            eq = self.equity_obs(obs, n=n, rng=np.random.default_rng(base), my_cards=keep,
                                 extra_board=extra)
            out.append((disc, eq))
        out.sort(key=lambda x: -x[1])
        return out

    def ms_per_sample(self) -> float:
        """Measured cost of one MC sample from a preflop state for this spec (cached).
        Bots use it to size n for their time budget: n = budget_ms / ms_per_sample()."""
        if getattr(self, "_ms_per_sample", None) is None:
            import time
            sp = self.spec
            d = sum(x.count for x in sp.discards)
            hole = sp.deck[-sp.hole_cards:]
            kw = dict(opp_num_cards=sp.hole_cards, board_to_come=sp.total_board_dealt,
                      my_discards_left=d, opp_discards_left=d,
                      discard_to_board=self._future_to_board(0), rng=np.random.default_rng(0))
            self.equity(hole, (), n=50, **kw)  # warm up
            t0 = time.perf_counter()
            self.equity(hole, (), n=400, **kw)
            self._ms_per_sample = (time.perf_counter() - t0) * 1000 / 400
        return self._ms_per_sample

    def preflop_equity(self, my_cards, n: int = 1500, rng=None) -> float:
        """Equity vs a random hand from the start of the hand, cached by (suit class, n),
        so bots sharing a process never inherit each other's precision."""
        cls = canonical(my_cards)
        key = (cls, int(n))
        v = self._pre_cache.get(key)
        if v is None:
            rng = rng if rng is not None else np.random.default_rng([*cls, int(n)])
            d = sum(x.count for x in self.spec.discards)
            v = self.equity(cls, (), opp_num_cards=self.spec.hole_cards,
                            board_to_come=self.spec.total_board_dealt,
                            my_discards_left=d, opp_discards_left=d,
                            discard_to_board=self._future_to_board(0), n=n, rng=rng)
            self._pre_cache[key] = v
        return v


_MODELS: dict = {}


def get_equity_model(spec: GameSpec) -> EquityModel:
    m = _MODELS.get(spec)
    if m is None:
        m = _MODELS[spec] = EquityModel(spec)
    return m
