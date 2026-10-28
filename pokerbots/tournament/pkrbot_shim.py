"""Test shim for MIT's pkrbot (not available offline): Deck + evaluate via our evaluator.
peek(n) returns the next n+1 cards so the engine deals a standard 3-card flop
(the real library's semantics are unknown here; see REPORT.md)."""
import random, sys
sys.path.insert(0, __import__("os").environ.get("POKERBOTS_ROOT", "."))
from engine.cards import card_str, parse_card, full_deck
from engine.evaluator import get_evaluator
from engine.variants import get_variant
_EV = get_evaluator(get_variant("c_discard3"))

class Card(str):
    pass

class Deck:
    def __init__(self):
        self.cards = [Card(card_str(c)) for c in full_deck()]
    def shuffle(self):
        random.shuffle(self.cards)
    def deal(self, n):
        out, self.cards = self.cards[:n], self.cards[n:]
        return list(out)
    def peek(self, n):
        return list(self.cards[:n + 1])

def evaluate(cards):
    cs = [parse_card(str(c)) for c in cards]
    return _EV.evaluate(cs[:2], cs[2:]) if len(cs) >= 5 else 0
