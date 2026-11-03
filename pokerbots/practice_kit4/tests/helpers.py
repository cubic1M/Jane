import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.seats import Controller   # noqa: E402


class FakeBot:
    """Stands in for a loaded BotFile."""

    def __init__(self, play, name="fake"):
        self.play = play
        self.name = name
        self.load_error = None


def ctrl(play, limit_ms=1000.0, enforce=True, name="fake"):
    return Controller(FakeBot(play, name), time_limit_ms=limit_ms, enforce=enforce)


def scripted(pre, post=0):
    """Returns preflop replies from the list `pre` in order, then `post`."""
    def play(view, memory):
        if view["street"] == 0:
            q = memory.setdefault("q", list(pre))
            return q.pop(0) if q else view["owe"]
        return post
    return play


def call_any(view, memory):
    return view["owe"]


def shove(view, memory):
    return view["max_add"]


def rigged(holes, board, fill=()):
    """Deck function: hole cards dealt one at a time clockwise from the left of
    the button (two rounds), then five board cards. `holes` lists each player's
    two cards in that dealing order."""
    first = [h[0] for h in holes]
    second = [h[1] for h in holes]
    order = first + second + list(board) + list(fill)
    return lambda hand_no: list(order)
