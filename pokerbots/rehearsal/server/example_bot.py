#!/usr/bin/env python3
"""A simple legal bot for the rehearsal protocol. Not a strong one.

Reads one JSON object per line on stdin, answers only "match_start" ("ready") and
"act" messages ("<id> <action>"), one line each, and flushes after every answer.
Logs go to stderr, never stdout.
"""
import json
import random
import sys

RANK_VALUE = {r: i for i, r in enumerate(["2", "3", "4", "5", "6", "7", "8", "9", "10",
                                         "J", "Q", "K", "A"])}


def rank(card: str) -> int:
    return RANK_VALUE[card[:-1]]          # "10h" -> "10", "Ah" -> "A"


def strength(cards) -> float:
    """Crude: high cards plus a bonus for pairs and suited cards."""
    ranks = [rank(c) for c in cards]
    suits = [c[-1] for c in cards]
    s = sum(ranks) / (13.0 * len(cards))
    s += 0.3 * (len(ranks) - len(set(ranks)))
    s += 0.1 * (len(suits) - len(set(suits)))
    return s


def choose_discard(msg) -> str:
    """Keep the two cards that score best with the board; discard the other two."""
    hole, board = msg["hole"], msg["board"]
    best = max(((a, b) for i, a in enumerate(hole) for b in hole[i + 1:]),
               key=lambda keep: strength(list(keep) + board))
    toss = [c for c in hole if c not in best][:msg["discard_count"]]
    return "discard " + " ".join(toss)


def choose_bet(msg, rng) -> str:
    legal = msg["legal"]
    s = strength(msg["hole"] + msg["board"])
    if "raise" in legal and s > 0.8 and rng.random() < 0.5:
        lo, hi = msg["raise_by"]
        return f"raise {min(hi, max(lo, msg['pot'] * 3 // 4))}"
    if "check" in legal:
        return "check"
    if msg["to_call"] <= max(msg["pot"] // 3, 10) or s > 0.7:
        return "call"
    return "fold"


def main() -> None:
    rng = random.Random(int(sys.argv[1]) if len(sys.argv) > 1 else 0)
    for line in sys.stdin:
        msg = json.loads(line)
        kind = msg["type"]
        if kind == "match_start":
            reply = "ready"
        elif kind == "act":
            action = choose_discard(msg) if msg["phase"] == "discard" else choose_bet(msg, rng)
            reply = f"{msg['id']} {action}"     # always echo the request id
        elif kind == "match_end":
            print(f"example_bot: final score {msg['score']}", file=sys.stderr)
            break
        else:
            continue                       # hand_start / hand_end: no reply
        sys.stdout.write(reply + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
