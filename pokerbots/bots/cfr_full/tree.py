"""Abstract betting tree built from a GameSpec.

The tree is the real game's betting restricted to a few actions per node, so every
abstract action is legal in the real game: the state machine below mirrors
engine/game.py exactly (blinds/ante, raise-to amounts, min-raise = max(last raise
size, BB), max = effective stack, pot-limit cap, round-closing and all-in rules).

Abstract actions at a decision node:
  * fold (only when facing a bet; folding when a check is free is dominated),
  * check or call,
  * up to a few raise sizes, as fractions f of (pot + call): raise_to = max_pip + f*(pot+call),
    rounded and clamped into [min_raise_to, max_raise_to], chosen per (street, raise depth),
  * all-in (= max_raise_to; under pot-limit that is the pot-sized raise),
with at most `cap` raises per street (the last allowed raise is all-in only).
A size whose added chips are >= `merge` of the all-in's is dropped (the shove covers it).

Nodes are stored in flat Python lists (fast scalar access in the trainer's DFS).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from engine.spec import GameSpec

DECISION, FOLD_T, SHOW_T = 0, 1, 2
A_FOLD, A_CHECK, A_CALL, A_RAISE = "f", "k", "c", "r"


@dataclass(frozen=True)
class TreeConfig:
    # fractions of (pot + call) per raise depth (index = raises already made this street);
    # depths beyond the tuple get all-in only.
    preflop: tuple = ((0.75,), (1.0,), (0.6,))
    postflop: tuple = ((0.5, 1.0), (1.0,))
    preflop_cap: int = 4
    postflop_cap: int = 3
    merge: float = 0.75
    # per-street overrides of `postflop` (street index -> sizes); e.g. {3: ((0.75,), (1.0,))}
    street_sizes: tuple = ()  # tuple of (street, sizes) pairs (hashable)

    def sizes(self, street: int):
        for s, sz in self.street_sizes:
            if s == street:
                return sz
        return self.preflop if street == 0 else self.postflop

    def cap(self, street: int) -> int:
        return self.preflop_cap if street == 0 else self.postflop_cap

    def to_dict(self):
        return dict(preflop=self.preflop, postflop=self.postflop, preflop_cap=self.preflop_cap,
                    postflop_cap=self.postflop_cap, merge=self.merge, street_sizes=self.street_sizes)


class BetState:
    """Betting state of one hand (mirrors engine HandState's betting fields)."""
    __slots__ = ("spec", "committed", "pips", "stacks", "street", "to_act", "last_raise",
                 "acted", "depth", "folded")

    def __init__(self, spec: GameSpec, stacks=None):
        self.spec = spec
        st = list(stacks) if stacks is not None else [spec.starting_stack] * 2
        self.committed = [0, 0]
        self.pips = [0, 0]
        self.stacks = st
        self.street = 0
        self.to_act = 0
        self.last_raise = spec.big_blind
        self.acted = [False, False]
        self.depth = 0
        self.folded = None
        if spec.ante:
            for p in (0, 1):
                self._put(p, spec.ante)
                self.pips[p] = 0
        self._put(0, spec.small_blind)
        self._put(1, spec.big_blind)

    def copy(self) -> "BetState":
        s = BetState.__new__(BetState)
        s.spec = self.spec
        s.committed = list(self.committed)
        s.pips = list(self.pips)
        s.stacks = list(self.stacks)
        s.street = self.street
        s.to_act = self.to_act
        s.last_raise = self.last_raise
        s.acted = list(self.acted)
        s.depth = self.depth
        s.folded = self.folded
        return s

    def _put(self, p, amount):
        amount = min(amount, self.stacks[p])
        self.stacks[p] -= amount
        self.pips[p] += amount
        self.committed[p] += amount
        return amount

    @property
    def pot(self) -> int:
        return self.committed[0] + self.committed[1]

    def _settled(self, q):
        return self.stacks[q] == 0 or (self.acted[q] and self.pips[q] == max(self.pips))

    def next_street(self) -> None:
        self.street += 1
        self.pips = [0, 0]
        self.acted = [False, False]
        self.last_raise = self.spec.big_blind
        self.depth = 0
        self.to_act = 1

    def _refund(self):
        hi = 0 if self.pips[0] > self.pips[1] else 1
        lo = 1 - hi
        excess = self.pips[hi] - self.pips[lo]
        if excess > 0 and self.stacks[lo] == 0:
            self.pips[hi] -= excess
            self.committed[hi] -= excess
            self.stacks[hi] += excess

    def resolve(self) -> str:
        """Advance through round ends / forced skips. Returns 'decision', 'fold' or 'showdown'."""
        if self.folded is not None:
            return "fold"
        while True:
            if self._settled(0) and self._settled(1):
                self._refund()
                if self.street >= self.spec.num_streets - 1:
                    return "showdown"
                self.next_street()
                continue
            p = self.to_act
            o = 1 - p
            if self.stacks[p] == 0 or (self.stacks[o] == 0 and self.pips[p] >= self.pips[o]):
                self.acted[p] = True
                self.to_act = o
                continue
            return "decision"

    def legal(self):
        """(call_amount, can_raise, min_raise_to, max_raise_to) exactly as engine legal()."""
        p = self.to_act
        o = 1 - p
        bb = self.spec.big_blind
        max_pip = max(self.pips)
        call_amt = min(max_pip - self.pips[p], self.stacks[p])
        can_raise = self.stacks[p] > call_amt and self.stacks[o] > 0
        lo = hi = 0
        if can_raise:
            hi = min(self.pips[p] + self.stacks[p], self.pips[o] + self.stacks[o])
            if self.spec.betting == "pot_limit":
                pot_after_call = self.pot + call_amt
                hi = min(hi, max_pip + pot_after_call)
            lo = min(max_pip + max(self.last_raise, bb), hi)
            if hi <= max_pip:
                can_raise = False
                lo = hi = 0
        return call_amt, can_raise, lo, hi

    def apply(self, kind: str, amount: int = 0) -> None:
        """Apply a real or abstract action of the player to act (kinds f/k/c/r, r = raise-to)."""
        p = self.to_act
        o = 1 - p
        if kind == A_FOLD:
            self.folded = p
            return
        call_amt, _, _, _ = self.legal()
        self.acted[p] = True
        if kind == A_CALL:
            self._put(p, call_amt)
        elif kind == A_RAISE:
            prev_max = max(self.pips)
            self._put(p, amount - self.pips[p])
            self.last_raise = max(self.last_raise, amount - prev_max)
            self.acted[o] = False
            self.depth += 1
        self.to_act = o


def raise_options(state: BetState, cfg: TreeConfig):
    """[(raise_to, frac)] abstract raises at this state (frac = -1.0 for all-in)."""
    call_amt, can_raise, lo, hi = state.legal()
    st = state.street
    if not can_raise or state.depth >= cfg.cap(st):
        return []
    p = state.to_act
    max_pip = max(state.pips)
    base = state.pot + call_amt
    sizes = cfg.sizes(st)
    out = []
    if state.depth < cfg.cap(st) - 1 and state.depth < len(sizes):
        allin_add = hi - state.pips[p]
        for f in sizes[state.depth]:
            to = int(round(max_pip + f * base))
            to = min(hi, max(lo, to))
            if to >= hi or (to - state.pips[p]) >= cfg.merge * allin_add:
                continue
            if all(to != x for x, _ in out):
                out.append((to, float(f)))
    out.append((hi, -1.0))
    return out


class Tree:
    """Flat abstract betting tree. Node ids are DFS preorder; root = 0."""

    def __init__(self, spec: GameSpec, cfg: TreeConfig = TreeConfig()):
        self.spec = spec
        self.cfg = cfg
        self.kind = []        # DECISION / FOLD_T / SHOW_T
        self.player = []      # acting position (decision nodes), -1 otherwise
        self.street = []
        self.pot = []
        self.committed = []   # (c0, c1)
        self.pips = []
        self.stacks = []
        self.depth = []
        self.facing = []      # call amount > 0
        self.actions = []     # list of (kind, amount, frac) per node
        self.children = []    # list of child ids per node
        self.u0 = []          # fold terminal: chips won by position 0; showdown: stake (min committed)
        self.parent = []
        self._build(BetState(spec), -1)
        self.n_nodes = len(self.kind)
        self.decision_nodes = [n for n in range(self.n_nodes) if self.kind[n] == DECISION]
        self.max_actions = max(len(a) for a in self.actions)

    # ---- construction ----------------------------------------------------------------
    def _new(self, st: BetState, kind: int, parent: int) -> int:
        n = len(self.kind)
        self.kind.append(kind)
        self.player.append(st.to_act if kind == DECISION else -1)
        self.street.append(st.street)
        self.pot.append(st.pot)
        self.committed.append(tuple(st.committed))
        self.pips.append(tuple(st.pips))
        self.stacks.append(tuple(st.stacks))
        self.depth.append(st.depth)
        self.actions.append([])
        self.children.append([])
        self.parent.append(parent)
        if kind == FOLD_T:
            f = st.folded
            self.u0.append(float(st.committed[1]) if f == 1 else -float(st.committed[0]))
        elif kind == SHOW_T:
            self.u0.append(float(min(st.committed)))
        else:
            self.u0.append(0.0)
        self.facing.append(False)
        return n

    def _build(self, st: BetState, parent: int) -> int:
        r = st.resolve()
        if r == "fold":
            return self._new(st, FOLD_T, parent)
        if r == "showdown":
            return self._new(st, SHOW_T, parent)
        n = self._new(st, DECISION, parent)
        call_amt, _, _, _ = st.legal()
        self.facing[n] = call_amt > 0
        acts = []
        if call_amt > 0:
            acts.append((A_FOLD, 0, 0.0))
            acts.append((A_CALL, call_amt, 0.0))
        else:
            acts.append((A_CHECK, 0, 0.0))
        for to, f in raise_options(st, self.cfg):
            acts.append((A_RAISE, to, f))
        self.actions[n] = acts
        kids = []
        for (k, amt, _) in acts:
            c = st.copy()
            c.apply(k, amt)
            kids.append(self._build(c, n))
        self.children[n] = kids
        return n

    # ---- summaries -------------------------------------------------------------------
    def summary(self) -> dict:
        dn = self.decision_nodes
        by_street = {}
        for n in dn:
            by_street[self.street[n]] = by_street.get(self.street[n], 0) + 1
        return dict(nodes=self.n_nodes, decision_nodes=len(dn), max_actions=self.max_actions,
                    decision_nodes_by_street=dict(sorted(by_street.items())))

    # ---- play-time helpers -------------------------------------------------------------
    def raise_fracs(self, n: int, state: BetState):
        """Effective size of each abstract raise at node n, as a fraction of (pot+call) of
        the abstract state, with all-in reported as its effective fraction too."""
        pot = self.pot[n]
        pips = self.pips[n]
        p = self.player[n]
        call = max(pips) - pips[p]
        base = pot + call
        out = []
        for i, (k, amt, f) in enumerate(self.actions[n]):
            if k == A_RAISE:
                out.append((i, (amt - max(pips)) / base, f < 0))
        return out


def pseudo_harmonic(x: float, a: float, b: float) -> float:
    """Probability of mapping bet fraction x (a <= x <= b) to the smaller size a
    (Ganzfried & Sandholm 2013)."""
    if b <= a:
        return 1.0
    return max(0.0, min(1.0, ((b - x) * (1 + a)) / ((b - a) * (1 + x))))


def map_raise(fracs, x: float, is_allin: bool, u: float):
    """Pick the abstract raise action for a real raise of fraction x. fracs = [(action index,
    frac, is_allin)]. u is a uniform(0,1) draw for the randomized mapping."""
    if not fracs:
        return None
    if is_allin:
        for i, f, a in fracs:
            if a:
                return i
    s = sorted(fracs, key=lambda t: t[1])
    if x <= s[0][1]:
        return s[0][0]
    if x >= s[-1][1]:
        return s[-1][0]
    for (ia, fa, _), (ib, fb, _) in zip(s, s[1:]):
        if fa <= x <= fb:
            return ia if u < pseudo_harmonic(x, fa, fb) else ib
    return s[-1][0]


def _log(x):
    return math.log(max(1.0, x))
