"""Equity-bucket card abstraction, driven only by the GameSpec.

Feature per (player, street) = equity vs one uniformly random opponent hand at the
moment that street's BETTING starts (after the street's board cards and discards),
with the same model as engine/equity.py:
  * opponent hole cards and future board cards uniform over unseen cards,
  * a future discard to the BOARD is a uniformly random card of that player's hand,
  * a future discard to the MUCK keeps the subset that is best on the final board.
It is computed by `BatchEquity`, a vectorised re-implementation of
EquityModel.equity that handles a whole batch of deals in one numpy pass (the engine
version takes one hand per call, far too slow for training). Unit tests check that
the two agree within Monte Carlo noise.

Preflop: if street 0 has no board cards and no discards, the feature is a table
lookup by suit-isomorphic class (169 classes in hold'em, 1755 for 3 cards, 16432 for
Omaha), computed once at training start and stored with the policy. Otherwise it
is Monte Carlo like the other streets.

Buckets: per street, percentiles of the feature over simulated deals (both
seats), computed at training start and stored with the policy, so play-time
bucketing uses exactly the same boundaries and the same sample count n (so the
feature noise matches too).

Discards are outside the CFR tree. During training both players discard with the
greedy rule "keep the option with the best equity" (batched, n_disc samples per
option), the same rule the bot uses at play time via EquityModel.discard_options.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from itertools import combinations, permutations

import numpy as np

from engine.evaluator import get_evaluator
from engine.spec import GameSpec

from .fasteval import FastEvaluator

_PERMS = np.array(list(permutations(range(4))), dtype=np.int64)  # (24, 4)


def canon_keys(cards: np.ndarray) -> np.ndarray:
    """Suit-isomorphic canonical key of each row of cards (M, h) -> (M,) int64."""
    cards = np.asarray(cards, dtype=np.int64)
    M, h = cards.shape
    w = 52 ** np.arange(h - 1, -1, -1, dtype=np.int64)
    best = None
    rk = cards & ~3
    su = cards & 3
    for perm in _PERMS:
        m = np.sort(rk | perm[su], axis=1) @ w
        best = m if best is None else np.minimum(best, m)
    return best


@dataclass
class AbstractionConfig:
    buckets: tuple = (16, 10, 10, 10)   # per street; extra streets reuse the last entry
    n_post: int = 0                      # MC samples per postflop feature (0 = auto from cost)
    n_disc: int = 0                      # MC samples per discard option in training (0 = auto)
    n_pre_mc: int = 0                    # preflop MC samples when no table (0 = auto)
    table_seconds: float = 6.0           # budget for the preflop class table
    n_fit: int = 3000                    # deals used to fit the percentile boundaries

    def k(self, street: int) -> int:
        b = self.buckets
        return int(b[street] if street < len(b) else b[-1])


class BatchEquity:
    """Vectorised spec-aware equity for a batch of deals (one hand per row).

    Hand scores come from fasteval.FastEvaluator (bit-identical to the engine evaluator,
    3-10x faster); fast=False uses the engine evaluator itself."""

    def __init__(self, spec: GameSpec, fast: bool = True):
        self.spec = spec
        self.engine_ev = get_evaluator(spec)
        self.ev = FastEvaluator(spec) if fast else self.engine_ev
        self.deck = np.array(spec.deck, dtype=np.int64)
        self.D = len(self.deck)
        self.pos = np.full(52, -1, dtype=np.int64)
        self.pos[self.deck] = np.arange(self.D)
        self.chunk = 1024 if spec.hole_usage == "exactly" else 4096
        if fast:
            self.chunk = 2048 if spec.hole_usage == "exactly" else 16384

    def _chunked(self, ev, holes, boards, chunk):
        n = len(holes)
        if n <= chunk:
            return ev.evaluate_batch(holes, boards)
        out = np.empty(n, dtype=np.int64)
        for i in range(0, n, chunk):
            out[i:i + chunk] = ev.evaluate_batch(holes[i:i + chunk], boards[i:i + chunk])
        return out

    def evaluate(self, holes: np.ndarray, boards: np.ndarray) -> np.ndarray:
        return self._chunked(self.ev, holes, boards, self.chunk)

    def evaluate_engine(self, holes: np.ndarray, boards: np.ndarray) -> np.ndarray:
        """The engine evaluator in its original chunks (used to time the sampling tiers, so
        the faster evaluator does not change the auto-chosen sample counts)."""
        return self._chunked(self.engine_ev, holes, boards, 1024 if self.spec.hole_usage == "exactly" else 4096)

    def best_keep(self, hole: np.ndarray, board: np.ndarray, n_discard: int) -> np.ndarray:
        if n_discard == 0:
            return self.evaluate(hole, board)
        h = hole.shape[1]
        best = None
        for keep in combinations(range(h), h - n_discard):
            s = self.evaluate(hole[:, list(keep)], board)
            best = s if best is None else np.maximum(best, s)
        return best

    def equity(self, my, board, dead, *, opp_num: int, board_to_come: int, my_left: int = 0,
               opp_left: int = 0, to_board: bool = True, n: int = 64, rng=None) -> np.ndarray:
        """my (B,h), board (B,b), dead (B,d) card arrays -> (B,) equity (win + tie/2)."""
        rng = rng if rng is not None else np.random.default_rng()
        my = np.asarray(my, dtype=np.int64)
        B = my.shape[0]
        board = np.asarray(board, dtype=np.int64).reshape(B, -1)
        dead = np.asarray(dead, dtype=np.int64).reshape(B, -1)
        known = np.zeros((B, self.D), dtype=bool)
        rows = np.arange(B)[:, None]
        for arr in (my, board, dead):
            if arr.shape[1]:
                known[rows, self.pos[arr]] = True
        A = self.D - int(known[0].sum())
        avail = np.nonzero(~known)[1].reshape(B, A)
        avail_cards = self.deck[avail]
        k = opp_num + board_to_come
        R = B * n
        # partial Fisher-Yates over the available cards of each (deal, sample) row
        W = np.broadcast_to(np.arange(A, dtype=np.int8), (R, A)).copy()
        ridx = np.arange(R)
        for i in range(k):
            j = i + (rng.random(R) * (A - i)).astype(np.int64)
            wi = W[:, i].copy()
            W[:, i] = W[ridx, j]
            W[ridx, j] = wi
        drow = np.repeat(np.arange(B), n)
        cards = avail_cards[drow[:, None], W[:, :k].astype(np.int64)]
        opp = cards[:, :opp_num]
        fut = cards[:, opp_num:]
        final_board = np.concatenate([np.repeat(board, n, axis=0), fut], axis=1)
        if (my_left or opp_left) and to_board:
            myr = np.repeat(my, n, axis=0)
            extra = []
            my_keep, opp_keep = myr, opp
            if my_left:
                idx = np.argsort(rng.random((R, myr.shape[1])), axis=1)
                d = np.take_along_axis(myr, idx, axis=1)
                extra.append(d[:, :my_left])
                my_keep = d[:, my_left:]
            if opp_left:
                idx = np.argsort(rng.random((R, opp.shape[1])), axis=1)
                d = np.take_along_axis(opp, idx, axis=1)
                extra.append(d[:, :opp_left])
                opp_keep = d[:, opp_left:]
            final_board = np.concatenate([final_board] + extra, axis=1)
            s_me = self.evaluate(my_keep, final_board)
            s_op = self.evaluate(opp_keep, final_board)
        else:
            if board_to_come == 0 and my_left == 0:
                s_me = np.repeat(self.evaluate(my, board), n)
            else:
                s_me = self.best_keep(np.repeat(my, n, axis=0), final_board, my_left)
            s_op = self.best_keep(opp, final_board, opp_left)
        r = (s_me > s_op) + 0.5 * (s_me == s_op)
        return r.reshape(B, n).mean(axis=1)


def _future_rules(spec: GameSpec, street: int):
    return [d for d in spec.discards if d.street > street]


def _next_to_board(spec: GameSpec, street: int) -> bool:
    fr = _future_rules(spec, street)
    return fr[0].to_board if fr else True


class CardAbstraction:
    """Spec-driven bucketer + deal simulator (training) + play-time bucketing."""

    def __init__(self, spec: GameSpec, cfg: AbstractionConfig = AbstractionConfig()):
        self.spec = spec
        self.cfg = cfg
        self.be = BatchEquity(spec)
        self.S = spec.num_streets
        self.K = [cfg.k(s) for s in range(self.S)]
        self.bounds = None           # list of arrays (K_s - 1,)
        self.table_keys = None       # sorted canonical keys
        self.table_vals = None
        self.n_post = cfg.n_post
        self.n_disc = cfg.n_disc
        self.n_pre = cfg.n_pre_mc
        self.info = {}

    # ---- configuration --------------------------------------------------------------
    def use_table(self) -> bool:
        sp = self.spec
        return sp.board_cards_per_street[0] == 0 and not sp.discards_on_street(0)

    def _auto_sizes(self, rng):
        """Pick MC sample counts from the measured evaluator cost on this machine/spec."""
        sp = self.spec
        h, b = sp.final_hole_cards, sp.final_board_cards
        cards = self.be.deck[np.argsort(rng.random((2000, self.be.D)), axis=1)[:, :h + b]]
        self.be.evaluate_engine(cards[:200, :h], cards[:200, h:])
        t0 = time.perf_counter()
        self.be.evaluate_engine(cards[:, :h], cards[:, h:])
        us = (time.perf_counter() - t0) / 2000 * 1e6
        self.be.evaluate(cards[:200, :h], cards[:200, h:])
        t0 = time.perf_counter()
        self.be.evaluate(cards[:, :h], cards[:, h:])
        self.info["fast_eval_us"] = (time.perf_counter() - t0) / 2000 * 1e6
        self.info["eval_us"] = us
        # cost tiers rather than a continuous formula, so a busy machine does not change
        # the abstraction: ~0.5 us/hand (hold'em-like) -> 56, Omaha-like (~5 us) -> 24
        if not self.n_post:
            self.n_post = 56 if us < 2.0 else 24
        if not self.n_disc:
            self.n_disc = 32 if us < 2.0 else 16
        if not self.n_pre:
            self.n_pre = self.n_post
        return us

    # ---- preflop table --------------------------------------------------------------
    def build_table(self, rng, eval_us: float):
        sp = self.spec
        h = sp.hole_cards
        D = self.be.D
        combos = np.array(list(combinations(range(D), h)), dtype=np.int64)
        cards = self.be.deck[combos]
        keys = canon_keys(cards)
        ukeys, first = np.unique(keys, return_index=True)
        reps = cards[first]
        C = len(ukeys)
        dtot = sum(d.count for d in sp.discards)
        evals_per_sample = 2 * (1 + (h if dtot and not _next_to_board(sp, 0) else 0))
        n = int(np.clip(self.cfg.table_seconds * 1e6 / (C * evals_per_sample * max(eval_us, 0.05)), 32, 2000))
        vals = np.empty(C)
        step = max(1, 200000 // n)
        for i in range(0, C, step):
            sl = slice(i, i + step)
            m = reps[sl]
            vals[sl] = self.be.equity(m, np.zeros((len(m), 0), np.int64), np.zeros((len(m), 0), np.int64),
                                      opp_num=h, board_to_come=sp.total_board_dealt,
                                      my_left=dtot, opp_left=dtot, to_board=_next_to_board(sp, 0),
                                      n=n, rng=rng)
        self.table_keys = ukeys
        self.table_vals = vals
        self.info["table_classes"] = C
        self.info["table_n"] = n

    def table_lookup(self, hole: np.ndarray) -> np.ndarray:
        k = canon_keys(hole)
        i = np.searchsorted(self.table_keys, k)
        return self.table_vals[i]

    # ---- features -------------------------------------------------------------------
    def street_feature(self, my, board, dead, *, street, opp_num, rng) -> np.ndarray:
        sp = self.spec
        if street == 0 and self.use_table():
            return self.table_lookup(my)
        left = sum(d.count for d in _future_rules(sp, street))
        n = self.n_pre if street == 0 else self.n_post
        return self.be.equity(my, board, dead, opp_num=opp_num,
                              board_to_come=sum(sp.board_cards_per_street[street + 1:]),
                              my_left=left, opp_left=left, to_board=_next_to_board(sp, street),
                              n=n, rng=rng)

    def simulate(self, B: int, rng):
        """Sample B deals. Returns feats (S, 2, B) float64 and outcome (B,) int8 (+1 = position 0 wins)."""
        sp = self.spec
        h = sp.hole_cards
        nb = sp.total_board_dealt
        perm = np.argsort(rng.random((B, self.be.D)), axis=1)[:, :2 * h + nb]
        dealt = self.be.deck[perm]
        hole = [dealt[:, :h], dealt[:, h:2 * h]]
        board_cards = dealt[:, 2 * h:]
        board = np.zeros((B, 0), np.int64)
        muck_own = [np.zeros((B, 0), np.int64), np.zeros((B, 0), np.int64)]  # own mucked discards
        muck_vis = [np.zeros((B, 0), np.int64), np.zeros((B, 0), np.int64)]  # face-up mucked, seen by opp
        feats = np.zeros((self.S, 2, B))
        cum = 0
        rules = list(sp.discards)
        for s in range(self.S):
            nbs = sp.board_cards_per_street[s]
            board = np.concatenate([board, board_cards[:, cum:cum + nbs]], axis=1)
            cum += nbs
            for ri, rule in enumerate(rules):
                if rule.street != s:
                    continue
                order = (1, 0) if rule.order == "oop_first" else (0, 1)
                for j, p in enumerate(order):
                    o = 1 - p
                    later = sum(r.count for r2, r in enumerate(rules) if r2 > ri)
                    opp_pending = rule.count if j == 0 else 0
                    opp_left = opp_pending + later
                    if opp_pending:
                        tb = rule.to_board
                    else:
                        nxt = [r for r2, r in enumerate(rules) if r2 > ri]
                        tb = nxt[0].to_board if nxt else True
                    choice = self._greedy_discard(hole[p], board, muck_own[p], muck_vis[o], rule,
                                                  opp_num=hole[o].shape[1], my_left=later,
                                                  opp_left=opp_left, to_board=tb, street=s, rng=rng)
                    hc = hole[p].shape[1]
                    opts = list(combinations(range(hc), rule.count))
                    disc_idx = np.array(opts, dtype=np.int64)[choice]            # (B, count)
                    keep_mask = np.ones((B, hc), bool)
                    keep_mask[np.arange(B)[:, None], disc_idx] = False
                    disc = np.take_along_axis(hole[p], disc_idx, axis=1)
                    hole[p] = hole[p][keep_mask].reshape(B, hc - rule.count)
                    if rule.to_board:
                        board = np.concatenate([board, disc], axis=1)
                    else:
                        muck_own[p] = np.concatenate([muck_own[p], disc], axis=1)
                        if rule.face_up:
                            muck_vis[p] = np.concatenate([muck_vis[p], disc], axis=1)
            for p in (0, 1):
                o = 1 - p
                dead = np.concatenate([muck_own[p], muck_vis[o]], axis=1)
                feats[s, p] = self.street_feature(hole[p], board, dead, street=s,
                                                  opp_num=hole[o].shape[1], rng=rng)
        s0 = self.be.evaluate(hole[0], board)
        s1 = self.be.evaluate(hole[1], board)
        outcome = np.sign(s0 - s1).astype(np.int8)
        return feats, outcome

    def _greedy_discard(self, hole, board, muck_own, opp_vis, rule, *, opp_num, my_left, opp_left,
                        to_board, street, rng):
        B, hc = hole.shape
        opts = list(combinations(range(hc), rule.count))
        btc = sum(self.spec.board_cards_per_street[street + 1:])
        eqs = np.empty((len(opts), B))
        # common random numbers across options (as EquityModel.discard_options): the known
        # card set is the same for every option, so one seed gives identical samples
        seed = int(rng.integers(2 ** 62))
        for i, disc in enumerate(opts):
            keep = [c for c in range(hc) if c not in disc]
            d = hole[:, list(disc)]
            bd = np.concatenate([board, d], axis=1) if rule.to_board else board
            dead = np.concatenate([muck_own, opp_vis] + ([] if rule.to_board else [d]), axis=1)
            eqs[i] = self.be.equity(hole[:, keep], bd, dead, opp_num=opp_num, board_to_come=btc,
                                    my_left=my_left, opp_left=opp_left, to_board=to_board,
                                    n=self.n_disc, rng=np.random.default_rng(seed))
        return np.argmax(eqs, axis=0)

    # ---- bucketing --------------------------------------------------------------------
    def fit(self, rng, n_fit: int = None, log=print):
        t0 = time.perf_counter()
        us = self._auto_sizes(rng)
        if self.use_table():
            self.build_table(rng, us)
        t1 = time.perf_counter()
        n_fit = n_fit or self.cfg.n_fit
        feats = []
        done = 0
        while done < n_fit:
            b = min(1024, n_fit - done)
            f, _ = self.simulate(b, rng)
            feats.append(f)
            done += b
        F = np.concatenate(feats, axis=2)  # (S, 2, n_fit)
        self.bounds = []
        for s in range(self.S):
            K = self.K[s]
            v = F[s].ravel()
            q = np.quantile(v, np.arange(1, K) / K)
            q = np.unique(q)
            self.bounds.append(q)
        self.K = [len(b) + 1 for b in self.bounds]
        t2 = time.perf_counter()
        self.info.update(n_post=self.n_post, n_disc=self.n_disc, n_pre=self.n_pre,
                         table_s=round(t1 - t0, 2), fit_s=round(t2 - t1, 2), K=list(self.K))
        if log:
            log(f"[abstraction] {self.spec.name}: eval {us:.2f} us/hand, n_post={self.n_post} "
                f"n_disc={self.n_disc} table={'%d classes n=%d' % (self.info['table_classes'], self.info['table_n']) if self.use_table() else 'none'} "
                f"({t1 - t0:.1f}s), boundaries from {n_fit} deals ({t2 - t1:.1f}s), buckets {self.K}")

    def bucketize(self, street: int, feat: np.ndarray) -> np.ndarray:
        return np.searchsorted(self.bounds[street], feat, side="right").astype(np.int16)

    def sample(self, B: int, rng):
        """(buckets (S, 2, B) int16, outcome (B,) int8)."""
        feats, outcome = self.simulate(B, rng)
        bk = np.empty(feats.shape, dtype=np.int16)
        for s in range(self.S):
            bk[s] = self.bucketize(s, feats[s])
        return bk, outcome

    # ---- play time --------------------------------------------------------------------
    def obs_feature(self, obs, rng) -> float:
        board = set(obs.board)
        dead = [c for c in tuple(obs.my_discards) + tuple(obs.opp_discards) if c not in board]
        my = np.array([list(obs.my_cards)], dtype=np.int64)
        bd = np.array([list(obs.board)], dtype=np.int64).reshape(1, -1)
        dd = np.array([dead], dtype=np.int64).reshape(1, -1)
        return float(self.street_feature(my, bd, dd, street=obs.street, opp_num=obs.opp_num_cards,
                                         rng=rng)[0])

    def obs_bucket(self, obs, rng) -> int:
        f = self.obs_feature(obs, rng)
        return int(np.searchsorted(self.bounds[obs.street], f, side="right"))

    # ---- persistence ------------------------------------------------------------------
    def state(self) -> dict:
        return dict(cfg=self.cfg.__dict__.copy(), bounds=[np.asarray(b) for b in self.bounds],
                    K=list(self.K), table_keys=self.table_keys, table_vals=self.table_vals,
                    n_post=self.n_post, n_disc=self.n_disc, n_pre=self.n_pre, info=dict(self.info))

    @classmethod
    def from_state(cls, spec: GameSpec, st: dict) -> "CardAbstraction":
        ab = cls(spec, AbstractionConfig(**st["cfg"]))
        ab.bounds = [np.asarray(b) for b in st["bounds"]]
        ab.K = list(st["K"])
        ab.table_keys = st["table_keys"]
        ab.table_vals = st["table_vals"]
        ab.n_post, ab.n_disc, ab.n_pre = st["n_post"], st["n_disc"], st["n_pre"]
        ab.info = dict(st.get("info", {}))
        return ab
