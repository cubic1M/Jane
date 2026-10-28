"""The abstract preflop betting tree, built from the GameSpec with the engine's own rules.

Betting abstraction (TreeConfig, every size is a parameter):
  * fold (only when facing a bet), check/call;
  * raise #1 by the SB (open): 2.5bb and pot; raise #1 by the BB after a limp (iso):
    pot and 2x pot; raise #2 (3-bet): 3x the raise-to it faces; raise #3 (4-bet): 2.3x;
    later raises: all-in only; all-in is always an option while raises < max_raises (4).
  * A raise that would put in at least `commit_frac` of the raiser's remaining stack
    becomes all-in. Every target is clamped to the legal [min_raise_to, max_raise_to]
    and duplicates are dropped, so at 20bb most sizes collapse to all-in, and with
    pot-limit betting "all-in" means the pot-limit maximum.

Legal bounds come from engine.game.HandState.legal itself (a scratch HandState whose
pips/stacks we set), and the round-end logic mirrors HandState._betting_round, so the
tree's legal actions are exactly the engine's.

Terminals: 'fold'; 'showdown' (someone is all-in, or the spec has no street after
preflop: equity is realised fully); 'flop' (both have chips behind: pot x realised
equity, see realised_share).
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field

import numpy as np

from engine.game import HandState

FOLD, CHECK, CALL, RAISE = "fold", "check", "call", "raise"
DECISION = "decision"
TERM_FOLD, TERM_SHOWDOWN, TERM_FLOP = "fold", "showdown", "flop"


@dataclass(frozen=True)
class TreeConfig:
    open_sizes: tuple = (("bb", 2.5), ("pot", 1.0))     # SB first in (raise-to)
    iso_sizes: tuple = (("pot", 1.0), ("pot", 2.0))     # BB raise after an SB limp
    threebet_sizes: tuple = (("mult", 3.0),)            # x the raise-to faced
    fourbet_sizes: tuple = (("mult", 2.3),)
    later_sizes: tuple = ()                             # 5-bet+: all-in only
    allow_allin: bool = True
    max_raises: int = 4
    commit_frac: float = 0.45
    # equity realisation when the hand reaches the flop with chips behind (SB is in
    # position postflop); all-in pots realise 1.0
    realise_ip: float = 1.0
    realise_oop: float = 0.92

    def to_dict(self) -> dict:
        return asdict(self)

    @staticmethod
    def from_dict(d: dict) -> "TreeConfig":
        d = dict(d)
        for k in ("open_sizes", "iso_sizes", "threebet_sizes", "fourbet_sizes", "later_sizes"):
            if k in d:
                d[k] = tuple(tuple(x) for x in d[k])
        return TreeConfig(**d)


def realised_share(E: np.ndarray, realise_ip: float, realise_oop: float) -> np.ndarray:
    """SB (in position postflop) share of the pot when SB's raw equity is E.
    Each side's equity is scaled by its realisation factor and renormalised, so the
    shares stay in [0, 1] and sum to 1 (zero-sum)."""
    a = realise_ip * E
    b = realise_oop * (1.0 - E)
    return a / np.maximum(a + b, 1e-12)


# --------------------------------------------------------------------------------------
# Betting state with the engine's rules
# --------------------------------------------------------------------------------------
_SCRATCH: dict = {}


def engine_legal(spec, pips, stacks, committed, p, last_raise):
    """engine.game.HandState.legal for an arbitrary betting state."""
    hs = _SCRATCH.get(spec)
    if hs is None:
        hs = _SCRATCH[spec] = HandState(spec, spec.deck)
    hs.pips, hs.stacks, hs.committed = list(pips), list(stacks), list(committed)
    return hs.legal(p, last_raise)


@dataclass
class BetState:
    spec: object
    pips: list
    stacks: list
    committed: list
    acted: list = field(default_factory=lambda: [False, False])
    last_raise: int = 0
    nraises: int = 0
    to_act: int = 0
    done: bool = False
    folder: int = -1

    @staticmethod
    def initial(spec, stacks=None) -> "BetState":
        """Antes and blinds posted exactly like HandState.play."""
        st = list(stacks) if stacks else [spec.starting_stack] * 2
        pips, com = [0, 0], [0, 0]

        def put(p, x):
            x = min(x, st[p])
            st[p] -= x
            pips[p] += x
            com[p] += x

        if spec.ante:
            for p in (0, 1):
                put(p, spec.ante)
                pips[p] = 0
        put(0, spec.small_blind)
        put(1, spec.big_blind)
        s = BetState(spec, pips, st, com, last_raise=spec.big_blind)
        s._advance(0)
        return s

    def copy(self) -> "BetState":
        return BetState(self.spec, list(self.pips), list(self.stacks), list(self.committed),
                        list(self.acted), self.last_raise, self.nraises, self.to_act,
                        self.done, self.folder)

    @property
    def pot(self) -> int:
        return sum(self.committed)

    def legal(self):
        return engine_legal(self.spec, self.pips, self.stacks, self.committed, self.to_act,
                            self.last_raise)

    def _settled(self, q):
        return self.stacks[q] == 0 or (self.acted[q] and self.pips[q] == max(self.pips))

    def _advance(self, p):
        """Find the next player to act from candidate p (HandState._betting_round loop)."""
        for _ in range(4):
            o = 1 - p
            if self._settled(0) and self._settled(1):
                return self._end_round()
            if self.stacks[p] == 0 or (self.stacks[o] == 0 and self.pips[p] >= self.pips[o]):
                self.acted[p] = True
                if self._settled(0) and self._settled(1):
                    return self._end_round()
                p = o
                continue
            self.to_act = p
            return
        raise RuntimeError("betting loop did not settle")

    def _end_round(self):
        self.done = True
        hi = 0 if self.pips[0] > self.pips[1] else 1
        lo = 1 - hi
        excess = self.pips[hi] - self.pips[lo]
        if excess > 0 and self.stacks[lo] == 0:   # uncalled excess is refunded
            self.pips[hi] -= excess
            self.committed[hi] -= excess
            self.stacks[hi] += excess

    def apply(self, kind: str, amount: int = 0) -> "BetState":
        """New state after the player to act does kind ('fold'/'check'/'call'/'raise' to amount)."""
        s = self.copy()
        p, o = s.to_act, 1 - s.to_act
        s.acted[p] = True
        if kind == FOLD:
            s.done, s.folder = True, p
            return s
        if kind == CALL:
            x = min(max(s.pips) - s.pips[p], s.stacks[p])
            s.stacks[p] -= x
            s.pips[p] += x
            s.committed[p] += x
        elif kind == RAISE:
            prev_max = max(s.pips)
            x = int(amount) - s.pips[p]
            s.stacks[p] -= x
            s.pips[p] += x
            s.committed[p] += x
            s.last_raise = max(s.last_raise, int(amount) - prev_max)
            s.nraises += 1
            s.acted[o] = False
        s._advance(o)
        return s

    def terminal_kind(self) -> str:
        if self.folder >= 0:
            return TERM_FOLD
        if self.spec.num_streets == 1 or min(self.stacks) == 0:
            return TERM_SHOWDOWN
        return TERM_FLOP


# --------------------------------------------------------------------------------------
# Raise sizes
# --------------------------------------------------------------------------------------
def raise_target(rule, *, max_pip, my_pip, my_stack, pot, call_amount, bb, lo, hi,
                 commit_frac) -> int:
    """Raise-to amount for an abstract size rule in a (real or abstract) state."""
    kind = rule[0]
    if kind == "bb":
        t = rule[1] * bb
    elif kind == "pot":
        t = max_pip + rule[1] * (pot + call_amount)
    elif kind == "mult":
        t = rule[1] * max_pip
    elif kind == "allin":
        t = hi
    else:
        raise ValueError(f"unknown size rule {rule!r}")
    if t - my_pip >= commit_frac * my_stack:
        t = hi
    return int(min(hi, max(lo, int(round(t)))))


def raise_fraction(amount, max_pip, pot, call_amount) -> float:
    """Raise size as a fraction of the pot after calling (used for translation)."""
    return (amount - max_pip) / max(1, pot + call_amount)


def size_rules(cfg: TreeConfig, nraises: int, player: int) -> tuple:
    if nraises == 0:
        sizes = cfg.open_sizes if player == 0 else cfg.iso_sizes
    elif nraises == 1:
        sizes = cfg.threebet_sizes
    elif nraises == 2:
        sizes = cfg.fourbet_sizes
    else:
        sizes = cfg.later_sizes
    return tuple(sizes) + ((("allin",),) if cfg.allow_allin else ())


def abstract_raises(state: BetState, cfg: TreeConfig, legal=None) -> list:
    """[(raise_to, rule), ...] ascending and distinct for the player to act."""
    lg = legal if legal is not None else state.legal()
    if not lg.can_raise or state.nraises >= cfg.max_raises:
        return []
    p = state.to_act
    out = {}
    for rule in size_rules(cfg, state.nraises, p):
        amt = raise_target(rule, max_pip=max(state.pips), my_pip=state.pips[p],
                           my_stack=state.stacks[p], pot=state.pot, call_amount=lg.call_amount,
                           bb=state.spec.big_blind, lo=lg.min_raise_to, hi=lg.max_raise_to,
                           commit_frac=cfg.commit_frac)
        if amt == lg.max_raise_to:
            rule = ("allin",)
        if amt not in out or rule == ("allin",):
            out[amt] = rule
    return sorted(out.items())


# --------------------------------------------------------------------------------------
# Tree
# --------------------------------------------------------------------------------------
@dataclass
class Node:
    id: int
    kind: str                     # DECISION or a terminal kind
    state: BetState
    player: int = -1
    labels: list = field(default_factory=list)    # 'f', 'k', 'c', 'r<amount>'
    kinds: list = field(default_factory=list)     # FOLD / CHECK / CALL / RAISE
    amounts: list = field(default_factory=list)   # raise-to for raises, else 0
    rules: list = field(default_factory=list)     # size rule for raises, else None
    children: list = field(default_factory=list)
    path: str = ""

    @property
    def is_terminal(self) -> bool:
        return self.kind != DECISION

    @property
    def num_actions(self) -> int:
        return len(self.children)


class Tree:
    def __init__(self, spec, cfg: TreeConfig = TreeConfig(), stacks=None):
        self.spec, self.cfg = spec, cfg
        self.nodes: list[Node] = []
        self.root = self._build(BetState.initial(spec, stacks), "")

    def _build(self, st: BetState, path: str) -> int:
        nid = len(self.nodes)
        if st.done:
            self.nodes.append(Node(nid, st.terminal_kind(), st, path=path))
            return nid
        node = Node(nid, DECISION, st, player=st.to_act, path=path)
        self.nodes.append(node)
        lg = st.legal()
        acts = []
        if lg.call_amount > 0:
            acts.append(("f", FOLD, 0, None))
            acts.append(("c", CALL, 0, None))
        else:
            acts.append(("k", CHECK, 0, None))
        for amt, rule in abstract_raises(st, self.cfg, lg):
            acts.append((f"r{amt}", RAISE, amt, rule))
        for lab, kind, amt, rule in acts:
            child = self._build(st.apply(kind, amt), path + ("-" if path else "") + lab)
            node.labels.append(lab)
            node.kinds.append(kind)
            node.amounts.append(amt)
            node.rules.append(rule)
            node.children.append(child)
        return nid

    @property
    def decision_nodes(self) -> list[Node]:
        return [n for n in self.nodes if n.kind == DECISION]

    @property
    def terminal_nodes(self) -> list[Node]:
        return [n for n in self.nodes if n.kind != DECISION]

    def fingerprint(self) -> tuple:
        return tuple((n.path, n.kind, tuple(n.labels)) for n in self.nodes)

    def describe(self) -> str:
        d = self.decision_nodes
        t = self.terminal_nodes
        kinds = {k: sum(1 for n in t if n.kind == k) for k in (TERM_FOLD, TERM_SHOWDOWN, TERM_FLOP)}
        root = self.nodes[self.root]
        return (f"{len(d)} decision nodes, {len(t)} terminals {kinds}; "
                f"root actions {root.labels}")


# --------------------------------------------------------------------------------------
# Off-tree translation
# --------------------------------------------------------------------------------------
def pseudo_harmonic(x: float, a: float, b: float) -> float:
    """Probability of mapping a bet of pot fraction x (a <= x <= b) to a
    (Ganzfried & Sandholm 2013 pseudo-harmonic mapping)."""
    if b <= a:
        return 1.0
    return float(min(1.0, max(0.0, (b - x) * (1 + a) / ((b - a) * (1 + x)))))


def map_raise(fracs, x: float, u: float, allin_index: int = -1, is_allin: bool = False) -> int:
    """Index among abstract raises (pot fractions `fracs`, ascending) for a real raise
    of pot fraction x; u is a uniform random number. A real all-in maps to the
    abstract all-in when there is one."""
    if is_allin and allin_index >= 0:
        return allin_index
    if x <= fracs[0]:
        return 0
    if x >= fracs[-1]:
        return len(fracs) - 1
    k = int(np.searchsorted(fracs, x)) - 1
    return k if u < pseudo_harmonic(x, fracs[k], fracs[k + 1]) else k + 1


# --------------------------------------------------------------------------------------
# Payoffs: the tree plus the bucket matrices
# --------------------------------------------------------------------------------------
class PreflopGame:
    """Zero-sum abstract preflop game. W[i, j]: chance probability that the SB holds
    bucket i and the BB bucket j (sums to 1). E[i, j]: SB equity. Terminal payoffs in
    chips for the SB: fold = the folder loses what they committed; showdown/flop =
    m * (2 * share - 1) with m = min(committed) (the engine refunds any excess), share =
    E when someone is all-in (or there is no later street), else realised_share(E)."""

    def __init__(self, tree: Tree, W: np.ndarray, E: np.ndarray, cfg: TreeConfig = None):
        cfg = cfg or tree.cfg
        self.tree, self.K = tree, W.shape[0]
        self.W = np.asarray(W, dtype=np.float64) / np.sum(W)
        self.E = np.asarray(E, dtype=np.float64)
        S = realised_share(self.E, cfg.realise_ip, cfg.realise_oop)
        A_sd = self.W * (2 * self.E - 1)
        A_fl = self.W * (2 * S - 1)
        self.mats = {TERM_SHOWDOWN: (A_sd, np.ascontiguousarray(A_sd.T)),
                     TERM_FLOP: (A_fl, np.ascontiguousarray(A_fl.T)),
                     TERM_FOLD: (self.W, np.ascontiguousarray(self.W.T))}

    def terminal_value(self, node: Node, p: int, r_opp: np.ndarray) -> np.ndarray:
        """Counterfactual value for player p, per own bucket, given the opponent's reach."""
        c0, c1 = node.state.committed
        M = self.mats[node.kind][p]
        if node.kind == TERM_FOLD:
            u_sb = -c0 if node.state.folder == 0 else c1
        else:
            u_sb = min(c0, c1)
        return (u_sb if p == 0 else -u_sb) * (M @ r_opp)
