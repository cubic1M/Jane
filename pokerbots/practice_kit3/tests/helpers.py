"""Shared test helpers: scripted bots and stacked decks."""

import os
import sys
import time

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if KIT not in sys.path:
    sys.path.insert(0, KIT)

from engine.cards import parse_cards  # noqa: E402
from engine.table import Table  # noqa: E402


def stacked_deck(*hands_then_board):
    """stacked_deck("As Ks 2d", "7h 7d 3c", "Ah 9c 4s 5s 6s") -> 52-card list.
    Holes are given in postflop order (first left of the button; heads-up the BB),
    then the 5 board cards; the rest of the deck follows in numeric order."""
    cards = []
    for chunk in hands_then_board:
        cards.extend(parse_cards(chunk))
    assert len(set(cards)) == len(cards), "duplicate card in stacked deck"
    return cards + [c for c in range(52) if c not in cards]


class ScriptBot:
    """Returns scripted actions in order (then 'c'); discards by a rule."""

    def __init__(self, actions=(), discard="first", record=None):
        self.actions = list(actions)
        self.discard = discard
        self.record = record if record is not None else {}
        self.record.setdefault("events", [])
        self.record.setdefault("states", [])
        self.record.setdefault("discard_states", [])

    def on_table_start(self, info):
        self.record["info"] = info

    def on_event(self, e):
        self.record["events"].append(e)

    def on_showdown(self, r):
        self.record["showdown"] = r

    def on_hand_end(self, r):
        self.record["end"] = r

    def on_discard_request(self, state):
        self.record["discard_states"].append(state)
        if callable(self.discard):
            return self.discard(state)
        if self.discard == "first":
            return state["hole_cards"][0]
        if self.discard == "last":
            return state["hole_cards"][2]
        return self.discard

    def on_action_request(self, state):
        self.record["states"].append(state)
        return self.actions.pop(0) if self.actions else "c"


def make(bot):
    return lambda: bot


def table(bots, stacks=None, deck=None, max_hands=1, ids=None, **kw):
    """Fixed-seat table: seat i = bots[i], button on seat 0, ids p0..pN."""
    ids = ids or ["p%d" % i for i in range(len(bots))]
    entrants = [("b%d" % i, make(b)) for i, b in enumerate(bots)]
    kw.setdefault("enforce_time", False)
    return Table(entrants, seed=1, ids=ids, shuffle_seats=False, button_seat=0,
                 stacks=stacks, deck_fn=(lambda n: deck) if deck else None,
                 max_hands=max_hands, **kw)


def busy(ms):
    end = time.perf_counter() + ms / 1000.0
    while time.perf_counter() < end:
        pass
