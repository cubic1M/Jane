"""opp_solver: the "small solver" a prepared team brings on the day.

Preflop: at the start of a match we solve an abstract preflop game for the spec
(cached at module level, keyed by the rules, so repeated matches do not re-solve):
  1. Simulate random heads-up matchups from a pool of random hands (spec-aware
     showdown, discards modelled like engine.equity), giving each pool hand a
     strength (equity vs a random hand) and a BxB bucket-vs-bucket equity matrix.
  2. Build a betting tree: fold / call / raise (0.75 pot open, pot after) / all-in
     (pot cap in pot-limit), at most MAX_RAISES raises, terminals valued from the
     bucket matrix (non-all-in terminals get a small realization/position model).
  3. Run vectorised CFR+ (linear averaging) on the tree under a time budget.
At play time the preflop history is mapped onto the tree (nearest raise size),
the bucket comes from the hand's preflop equity, and the average strategy is
sampled. The opponent's path through the tree also gives a bucket range that
weights the postflop equity sampler.

Postflop: equity vs that range (or vs a random hand after discards), pot-odds
discipline with a margin that grows with bet size and shrinks against aggressive
opponents, two bet sizes (~40% / ~75% pot), mixed slow-plays and bluffs.
Fallback (no solve, odd stack depth, path off-tree): equity-threshold rules.
"""
from __future__ import annotations

import math
import time
from itertools import combinations

import numpy as np

from engine.bot import Bot
from engine.equity import get_equity_model
from engine.game import Call, Check, Discard, Fold, RaiseTo

B = 14             # equity buckets
MAX_RAISES = 4
OPEN_FRAC, RAISE_FRAC = 0.75, 1.0   # raise-by as a fraction of the pot after calling
ALLIN_COLLAPSE = 0.45               # a raise bigger than this share of the stack = all-in
SOLVE_BUDGET_S = 14.0
_CACHE: dict = {}


def _key(spec):
    return spec.with_(name="", notes="", hands_per_match=0, time_per_decision=None,
                      time_per_match=None)


# ---------------------------------------------------------------------------------
# 1. matchup simulation -> pool strengths and bucket equity matrix
def _showdown(spec, ev, h0, h1, board, rng):
    d = sum(r.count for r in spec.discards)
    if d and spec.discards[0].to_board:   # random discards to the board (engine model)
        k0 = np.take_along_axis(h0, np.argsort(rng.random(h0.shape), 1), 1)
        k1 = np.take_along_axis(h1, np.argsort(rng.random(h1.shape), 1), 1)
        board = np.concatenate([board, k0[:, :d], k1[:, :d]], 1)
        return ev.evaluate_batch(k0[:, d:], board), ev.evaluate_batch(k1[:, d:], board)
    if d:   # discards to the muck: best keep in hindsight for both
        out = []
        for h in (h0, h1):
            best = None
            for keep in combinations(range(h.shape[1]), h.shape[1] - d):
                s = ev.evaluate_batch(h[:, list(keep)], board)
                best = s if best is None else np.maximum(best, s)
            out.append(best)
        return out
    return ev.evaluate_batch(h0, board), ev.evaluate_batch(h1, board)


def pre_n(spec):
    """Samples for a preflop equity lookup (~5 ms); shared by the solve and the bot so
    the engine's preflop cache is warmed by the solve."""
    return int(np.clip(round(5.0 / get_equity_model(spec).ms_per_sample(), -2), 100, 1200))


def simulate(spec, rng, budget_s):
    m = get_equity_model(spec)
    ms = m.ms_per_sample()
    n_total = int(np.clip(budget_s * 1000 / ms, 20000, 300000))
    K = int(np.clip(n_total * 2 // 250, 300, 3000))
    deck = np.array(spec.deck, dtype=np.int64)
    h, nb = spec.hole_cards, spec.total_board_dealt
    pool = np.sort(deck[np.argsort(rng.random((K, len(deck))), 1)[:, :h]], 1)
    I, J, R = [], [], []
    t_end = time.perf_counter() + budget_s
    done = 0
    while done < n_total and time.perf_counter() < t_end:
        c = min(40000, n_total - done)
        i = rng.integers(K, size=int(c * 1.6))
        j = rng.integers(K, size=int(c * 1.6))
        ok = ~(pool[i][:, :, None] == pool[j][:, None, :]).any((1, 2))
        i, j = i[ok][:c], j[ok][:c]
        n = len(i)
        keys = rng.random((n, len(deck)))
        used = np.concatenate([pool[i], pool[j]], 1)
        np.put_along_axis(keys, np.searchsorted(deck, used), 2.0, 1)
        board = deck[np.argpartition(keys, nb - 1, 1)[:, :nb]] if nb else np.zeros((n, 0), np.int64)
        s0, s1 = _showdown(spec, m.ev, pool[i], pool[j], board, rng)
        I.append(i); J.append(j); R.append((s0 > s1) + 0.5 * (s0 == s1))
        done += n
    I, J, R = np.concatenate(I), np.concatenate(J), np.concatenate(R)
    cnt = np.bincount(I, minlength=K) + np.bincount(J, minlength=K)
    tot = np.bincount(I, R, minlength=K) + np.bincount(J, 1 - R, minlength=K)
    strength = (tot + 1.0) / (cnt + 2.0)
    if spec.hole_cards == 2:   # few suit classes: use (cached) exact-ish class equities
        npre = pre_n(spec)
        strength = np.array([m.preflop_equity(tuple(int(c) for c in row), n=npre) for row in pool])
    edges = np.quantile(strength, np.arange(1, B) / B)
    pb = np.searchsorted(edges, strength)
    num = np.zeros((B, B)); den = np.zeros((B, B))
    np.add.at(num, (pb[I], pb[J]), R); np.add.at(den, (pb[I], pb[J]), 1)
    np.add.at(num, (pb[J], pb[I]), 1 - R); np.add.at(den, (pb[J], pb[I]), 1)
    E = (num + 0.5) / (den + 1.0)
    E = 0.5 * (E + 1 - E.T)
    return pool, pb, edges, E


# ---------------------------------------------------------------------------------
# 2. abstract preflop tree
class Node:
    __slots__ = ("id", "player", "pips", "nraises", "last_raise", "acted", "labels",
                 "amounts", "children", "U", "terminal")


def raise_amounts(spec, pips, actor, nraises, last_raise, smax):
    """Candidate (label, raise-to) for the actor; same rule used in the tree and live."""
    o = 1 - actor
    mx = max(pips)
    call = mx - pips[actor]
    if nraises >= MAX_RAISES or smax - pips[actor] <= call or smax - pips[o] <= 0:
        return []
    pot_after = 2 * spec.ante + pips[0] + pips[1] + call
    hi = smax
    if spec.betting == "pot_limit":
        hi = min(hi, mx + pot_after)
    lo = min(mx + max(last_raise, spec.big_blind), hi)
    if hi <= mx:
        return []
    std = int(round(mx + (OPEN_FRAC if nraises == 0 else RAISE_FRAC) * pot_after))
    std = min(max(std, lo), hi)
    out = []
    if std < hi and (spec.betting == "pot_limit" or std < ALLIN_COLLAPSE * smax):
        out.append(("r", std))
    out.append(("a", hi))
    return out


def build_tree(spec, E):
    smax = spec.starting_stack - spec.ante
    nodes = []
    pos_eq = 0.025

    def show_U(pips, allin):
        com = np.array(pips) + spec.ante
        pot = com.sum()
        e = E if allin else np.clip(0.5 + 1.1 * (E - 0.5) + pos_eq, 0, 1)
        return pot * e - com[0]

    def make(pips, actor, nraises, last_raise, acted):
        nd = Node(); nd.id = len(nodes); nodes.append(nd)
        nd.player, nd.pips, nd.nraises, nd.last_raise, nd.acted = actor, tuple(pips), nraises, last_raise, acted
        nd.terminal, nd.U = None, None
        o = 1 - actor
        call = max(pips) - pips[actor]
        nd.labels, nd.amounts, nd.children = [], [], []
        if call > 0:
            t = Node(); t.id = len(nodes); nodes.append(t); t.terminal = "fold"; t.player = None
            com = np.array(pips) + spec.ante
            t.U = np.full((B, B), float(com[1])) if actor == 1 else np.full((B, B), float(-com[0]))
            nd.labels.append("f"); nd.amounts.append(None); nd.children.append(t)
        np_ = list(pips); np_[actor] = max(pips)
        acted2 = list(acted); acted2[actor] = True
        if acted2[o] or max(np_) >= smax:
            t = Node(); t.id = len(nodes); nodes.append(t); t.terminal = "show"; t.player = None
            t.U = show_U(np_, max(np_) >= smax)
            c = t
        else:
            c = make(np_, o, nraises, last_raise, tuple(acted2))
        nd.labels.append("c"); nd.amounts.append(None); nd.children.append(c)
        for lab, amt in raise_amounts(spec, pips, actor, nraises, last_raise, smax):
            rp = list(pips); rp[actor] = amt
            a2 = [False, False]; a2[actor] = True
            c = make(rp, o, nraises + 1, max(last_raise, amt - max(pips)), tuple(a2))
            nd.labels.append(lab); nd.amounts.append(amt); nd.children.append(c)
        return nd

    sb, bb = spec.small_blind, spec.big_blind
    root = make([min(sb, smax), min(bb, smax)], 0, 0, bb, (False, False))
    return root, nodes


# ---------------------------------------------------------------------------------
# 3. vectorised CFR+
def solve_cfr(root, nodes, budget_s, max_iter=4000):
    dec = [n for n in nodes if n.terminal is None]
    regret = {n.id: np.zeros((B, len(n.children))) for n in dec}
    ssum = {n.id: np.zeros((B, len(n.children))) for n in dec}

    def strat(n):
        r = regret[n.id]
        s = r.sum(1, keepdims=True)
        return np.where(s > 0, r / np.where(s > 0, s, 1), 1.0 / r.shape[1])

    def walk(n, mine, opp, trav, w):
        """Values per traverser bucket; mine/opp = reach of traverser/opponent buckets."""
        if n.terminal is not None:
            return n.U @ opp if trav == 0 else -(n.U.T @ opp)
        sig = strat(n)
        if n.player == trav:
            vals = np.stack([walk(c, mine * sig[:, a], opp, trav, w)
                             for a, c in enumerate(n.children)], 1)
            v = (sig * vals).sum(1)
            regret[n.id] = np.maximum(regret[n.id] + vals - v[:, None], 0)
            ssum[n.id] += w * mine[:, None] * sig
            return v
        return sum(walk(c, mine, opp * sig[:, a], trav, w) for a, c in enumerate(n.children))

    t0 = time.perf_counter()
    it = 0
    ones = np.ones(B) / B
    while it < max_iter and time.perf_counter() - t0 < budget_s:
        it += 1
        for trav in (0, 1):
            walk(root, ones, ones, trav, it)
    avg = {}
    for n in dec:
        s = ssum[n.id]
        tot = s.sum(1, keepdims=True)
        avg[n.id] = np.where(tot > 0, s / np.where(tot > 0, tot, 1), 1.0 / s.shape[1])
    return avg, it


class Solution:
    def __init__(self, spec, seed=0, budget_s=SOLVE_BUDGET_S):
        t0 = time.perf_counter()
        rng = np.random.default_rng(seed + 12345)
        self.pool, self.pool_bucket, self.edges, self.E = simulate(spec, rng, budget_s * 0.45)
        self.root, self.nodes = build_tree(spec, self.E)
        rest = max(0.5, budget_s - (time.perf_counter() - t0) - 0.3)
        self.avg, self.iters = solve_cfr(self.root, self.nodes, rest)
        self.smax = spec.starting_stack - spec.ante
        self.n_pre = pre_n(spec)
        self.seconds = time.perf_counter() - t0


def get_solution(spec, budget_s=SOLVE_BUDGET_S):
    k = _key(spec)
    sol = _CACHE.get(k)
    if sol is None:
        sol = _CACHE[k] = Solution(spec, budget_s=budget_s)
    return sol


# ---------------------------------------------------------------------------------
class SolverBot(Bot):
    name = "opp_solver"

    def __init__(self, solve=True, budget_s=SOLVE_BUDGET_S):
        self.solve, self.budget_s = solve, budget_s

    def new_match(self, spec, seed=0):
        super().new_match(spec, seed)
        self.np_rng = np.random.default_rng(seed)
        self.m = get_equity_model(spec)
        self.msps = self.m.ms_per_sample()
        self.sol = None
        budget = self.budget_s
        if spec.time_per_match:
            budget = min(budget, 0.2 * spec.time_per_match)
        if self.solve and budget >= 1.0:
            try:
                self.sol = get_solution(spec, budget)
            except Exception:   # never let the solver cost us the match
                self.sol = None
        self.opp_agg = [1.0, 3.0]   # postflop opp (bets+raises, opportunities), prior 1/3
        self.opp_pre = [0, 0]       # hands seen, hands where the opponent shoved preflop
        self._range = (None, None)

    # ---- helpers ------------------------------------------------------------------
    def _n(self, ms_budget=4.0, lo=40, hi=2000):
        if self.spec.time_per_decision:
            ms_budget = min(ms_budget, 150 * self.spec.time_per_decision)
        return int(np.clip(ms_budget / self.msps, lo, hi))

    def _pre_eq(self, cards):
        n = self.sol.n_pre if self.sol is not None else pre_n(self.spec)
        if self.spec.time_per_decision:
            n = min(n, self._n(5.0, 50, 1200))
        return self.m.preflop_equity(cards, n=n)

    def _bucket(self, cards):
        return int(np.searchsorted(self.sol.edges, self._pre_eq(cards)))

    def _replay(self, obs):
        """Map the preflop history onto the tree. Returns (node, opp actions) or (None, ..)."""
        sol = self.sol
        if sol is None:
            return None, []
        eff = min(obs.my_stack + obs.my_committed, obs.opp_stack + obs.opp_committed) - self.spec.ante
        if abs(eff - sol.smax) > 0.25 * sol.smax:   # stack depth far from the solved one
            return None, []
        node, path = sol.root, []
        for rec in obs.history:
            if rec.street != 0:
                break
            if node is None or node.terminal is not None or rec.position != node.player:
                return None, path
            if rec.kind in ("call", "check"):
                a = node.labels.index("c")
            elif rec.kind == "raise":
                cand = [(abs(math.log(rec.amount / amt)), k) for k, amt in enumerate(node.amounts)
                        if amt is not None]
                if not cand:
                    return None, path
                a = min(cand)[1]
            else:
                return None, path
            path.append((node, a))
            node = node.children[a]
        return node, path

    def _opp_weights(self, obs):
        if self._range[0] == obs.hand_index:
            return self._range[1]
        w = None
        if self.sol is not None:
            node, path = self._replay(obs)
            w = np.ones(B)
            for nd, a in path:
                if nd.player != obs.position:
                    w = w * self.sol.avg[nd.id][:, a]
            if w.sum() <= 1e-9:
                w = None
        self._range = (obs.hand_index, w)
        return w

    def _sampler(self, obs):
        if self.sol is None or obs.opp_num_cards != self.spec.hole_cards:
            return None
        w = self._opp_weights(obs)
        if w is None:
            return None
        pool, pw = self.sol.pool, w[self.sol.pool_bucket]

        def sample(n, avail, rng):
            ok = np.isin(pool, avail).all(1) & (pw > 0)
            idx = np.flatnonzero(ok)
            p = pw[idx] / pw[idx].sum()
            return pool[rng.choice(idx, size=n, p=p)]
        return sample

    def _raise(self, obs, frac):
        lg = obs.legal
        mx = max(obs.my_pip, obs.opp_pip)
        amt = lg.clamp_raise(mx + frac * (obs.pot + lg.call_amount))
        # do not leave a sliver behind: jam when the remainder is small vs the pot
        if lg.max_raise_to - amt < 0.35 * (obs.pot + 2 * (amt - obs.my_pip)):
            amt = lg.max_raise_to
        return RaiseTo(amt)

    # ---- decisions ----------------------------------------------------------------
    def act(self, obs):
        lg = obs.legal
        if lg.discard_count:
            return self._discard(obs)
        if obs.street == 0:
            a = self._vs_jammer(obs)
            if a is None:
                a = self._preflop_solved(obs)
            if a is not None:
                return a
            return self._preflop_rule(obs)
        return self._postflop(obs)

    def _discard(self, obs):
        k = obs.legal.discard_count
        nopt = math.comb(len(obs.my_cards), k)
        try:
            opts = self.m.discard_options(obs, n=self._n(6.0 / nopt, 30, 600), rng=self.np_rng)
            return Discard(opts[0][0])
        except Exception:
            return Discard(sorted(obs.my_cards)[:k])

    def _preflop_solved(self, obs):
        node, _ = self._replay(obs)
        if node is None or node.terminal is not None or node.player != obs.position:
            return None
        sig = self.sol.avg[node.id][self._bucket(obs.my_cards)]
        a = int(self.np_rng.choice(len(sig), p=sig / sig.sum()))
        lab, lg = node.labels[a], obs.legal
        if lab == "f":
            return Check() if lg.can_check else Fold()
        if lab == "c" or not lg.can_raise:
            return lg.passive()
        if lab == "a":
            return RaiseTo(lg.max_raise_to)
        nr = sum(1 for r in obs.history if r.street == 0 and r.kind == "raise")
        mx = max(obs.my_pip, obs.opp_pip)
        frac = OPEN_FRAC if nr == 0 else RAISE_FRAC
        return RaiseTo(lg.clamp_raise(mx + frac * (obs.pot + lg.call_amount)))

    def _vs_jammer(self, obs):
        """Exploit: an opponent who shoves preflop far too often has a near-random
        range, so call shoves on equity vs a random hand and pot odds."""
        lg = obs.legal
        hands, jams = self.opp_pre
        if obs.opp_stack > 0 or lg.call_amount == 0 or hands < 20 or jams / hands < 0.15:
            return None
        e = self._pre_eq(obs.my_cards)
        return Call() if e > lg.call_amount / (obs.pot + lg.call_amount) + 0.03 else Fold()

    def _preflop_rule(self, obs):
        """Fallback: preflop equity vs pot odds, scaled to the variant's equity spread."""
        lg = obs.legal
        e = self._pre_eq(obs.my_cards)
        call = lg.call_amount
        po = call / (obs.pot + call) if call else 0.0
        nr = sum(1 for r in obs.history if r.street == 0 and r.kind == "raise")
        if lg.can_raise and e > 0.58 + 0.04 * nr:
            if e > 0.66 and nr >= 2:
                return RaiseTo(lg.max_raise_to)
            return self._raise(obs, OPEN_FRAC if nr == 0 else RAISE_FRAC)
        if call == 0:
            return Check()
        if e > po + 0.06 + 0.03 * nr or (obs.position == 0 and nr == 0 and e > 0.45):
            return Call()
        return Fold()

    def _postflop(self, obs):
        lg = obs.legal
        # opponent aggression bookkeeping (their actions earlier this street/hand)
        n = self._n(4.0, 60, 1500)
        try:
            eq = self.m.equity_obs(obs, n=n, rng=self.np_rng, opp_sampler=self._sampler(obs))
        except Exception:
            eq = self.m.equity_obs(obs, n=n, rng=self.np_rng)
        pot, call = obs.pot, lg.call_amount
        last = obs.street == self.spec.num_streets - 1
        agg = self.opp_agg[0] / self.opp_agg[1]
        u = self.rng.random()
        if call > 0:
            po = call / (pot + call)
            bet_frac = call / max(1, pot - call)
            margin = (0.03 + 0.07 * min(bet_frac, 1.5)) * float(np.clip((0.3 / max(agg, 0.05)) ** 1.5, 0.3, 1.5))
            if last:
                margin += 0.03
            if lg.can_raise and eq > 0.82 - 0.03 * (not last) and u < 0.85:
                return self._raise(obs, 0.8)
            if eq > po + margin:
                return Call()
            # rare bluff-raise of a small bet on early streets with some equity
            if lg.can_raise and not last and bet_frac < 0.6 and 0.3 < eq < 0.45 and u < 0.06:
                return self._raise(obs, 0.8)
            return Fold()
        # no bet to face
        vt = 0.60 + 0.03 * (obs.street - 1 if not last else 2)
        if lg.can_raise:
            if eq > vt:
                if eq > 0.85 and obs.position == 1 and u < 0.15 and not last:
                    return Check()   # slow-play sometimes out of position
                p_big = float(np.clip((eq - 0.68) / 0.2, 0, 1))
                return self._raise(obs, 0.75 if self.rng.random() < p_big else 0.4)
            # semi-bluff / bluff: draws on early streets, air on the river
            if (not last and 0.38 < eq < vt and u < 0.18) or (last and eq < 0.25 and u < 0.10):
                return self._raise(obs, 0.4 if not last else 0.75)
        return Check()

    def end_hand(self, result):
        # postflop aggression of the opponent: bets/raises per opportunity
        opp = 1 - result.position
        self.opp_pre[0] += 1
        cap = self.spec.starting_stack - self.spec.ante
        if any(r.position == opp and r.street == 0 and r.kind == "raise" and r.amount >= 0.9 * cap
               for r in result.history):
            self.opp_pre[1] += 1
        for r in result.history:
            if r.position == opp and r.street > 0 and r.kind in ("raise", "check", "call", "fold"):
                self.opp_agg[1] += 1
                if r.kind == "raise":
                    self.opp_agg[0] += 1


def make_bot(**kw):
    return SolverBot(**kw)
