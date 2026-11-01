"""Test helpers: in-memory bots and rigged decks."""

import sys
from pathlib import Path
from types import SimpleNamespace

KIT = Path(__file__).resolve().parents[1]
if str(KIT) not in sys.path:
    sys.path.insert(0, str(KIT))

from simkit.agent import BotAgent  # noqa: E402
from simkit.cards import full_deck  # noqa: E402
from simkit.table import Table  # noqa: E402


def agent(name, get_action, init=None, on_hand_end=None, enforce_time=False,
          **kw):
    def loader():
        ns = SimpleNamespace(get_action=get_action)
        if init is not None:
            ns.init = init
        if on_hand_end is not None:
            ns.on_hand_end = on_hand_end
        return ns
    return BotAgent(name, loader, enforce_time=enforce_time, **kw)


def script(actions, draw=None, log=None):
    """get_action that replays betting replies in order (then checks/folds),
    and answers draws with draw (a reply dict) or stands pat."""
    queue = list(actions)

    def get_action(state):
        if log is not None:
            log.append(state)
        if state["type"] == "draw":
            return draw if draw is not None else {"discard": None}
        if queue:
            return queue.pop(0)
        me = state["players"][state["my_seat"]]
        if state["current_bet"] > me["chips_in_pot_this_round"]:
            return {"action": "call"}
        return {"action": "check"}
    return get_action


def rig(holes, board, draws=(), n=None):
    """Deck that deals holes[seat] to each seat (seat 0 = button), then the
    flop, then draw replacements, then turn and river."""
    n = n or len(holes)
    order = [(1 + i) % n for i in range(n)]
    top = []
    for k in range(2):
        for s in order:
            top.append(holes[s][k])
    top += list(board[:3]) + list(draws) + list(board[3:5])
    assert len(set(top)) == len(top), "duplicate card in rig"
    rest = [c for c in full_deck() if c not in top]
    deck = top + rest
    return lambda rng: list(deck)


def table(agents, **kw):
    return Table(agents, **kw)
