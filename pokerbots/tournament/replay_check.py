"""Cross-check our GameSpec against a tournament server's hand log.

Replays every logged hand (cards, actions) through OUR engine with OUR spec and
compares chip results. Any mismatch means our rules mapping is wrong somewhere
(blinds, raise semantics, limits, discards, showdown). Parser written for the
rehearsal server's log format; adapt `parse_log` for another server.

    python3 tournament/replay_check.py rehearsal/server/logs/r1.log k_irish
"""
from __future__ import annotations

import re
import sys

sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.dirname(__import__("os").path.abspath(__file__))))

from engine.game import Call, Check, Discard, Fold, HandState, RaiseTo  # noqa: E402
from engine.variants import get_variant  # noqa: E402
from tournament.stdio_json_adapter import to_ours  # noqa: E402


def parse_log(path):
    hands, cur = [], None
    for line in open(path):
        line = line.rstrip()
        m = re.match(r"Hand (\d+): (\w+)\(D/SB,seat1\) vs (\w+)\(BB,seat0\)", line)
        if m:
            cur = dict(n=int(m.group(1)), sb=m.group(2), bb=m.group(3), dealt={}, acts=[], board=[], result={})
            hands.append(cur)
            continue
        if cur is None:
            continue
        s = line.strip()
        m = re.match(r"(\w+)\([^)]*\) dealt (.+)", s)
        if m:
            cur["dealt"][m.group(1)] = m.group(2).split()
            continue
        m = re.match(r"board (.+)", s)
        if m:
            cur["board"] = m.group(1).split()
            continue
        m = re.match(r"result (\w+) ([+-]\d+), (\w+) ([+-]\d+)", s)
        if m:
            cur["result"] = {m.group(1): int(m.group(2)), m.group(3): int(m.group(4))}
            continue
        m = re.match(r"(\w+): (post|call|check|fold|raise|discard)\b(.*)", s)
        if m:
            cur["acts"].append((m.group(1), m.group(2), m.group(3).split()))
    return hands


def replay(h, spec):
    sb, bb = h["sb"], h["bb"]
    # cards the log does not show (board after a fold) cannot change a folded hand's
    # result, so pad the board with unused cards
    deck = [to_ours(c) for c in h["dealt"][sb] + h["dealt"][bb] + h["board"]]
    deck += [c for c in spec.deck if c not in deck]
    acts = [a for a in h["acts"] if a[1] != "post"]
    i = [0]

    def decide(pos, obs):
        who, kind, args = acts[i[0]]
        i[0] += 1
        assert who == (sb if pos == 0 else bb), f"hand {h['n']}: expected {who} to act, our engine asks position {pos}"
        if kind == "discard":
            return Discard([to_ours(c) for c in args])
        if kind == "fold":
            return Fold()
        if kind == "check":
            return Check()
        if kind == "call":
            return Call()
        return RaiseTo(max(obs.my_pip, obs.opp_pip) + int(args[0]))

    st = HandState(spec, deck)
    d = st.play(decide)
    return {sb: d[0], bb: d[1]}


def main(path, variant):
    spec = get_variant(variant)
    hands = parse_log(path)
    ok = bad = skipped = 0
    for h in hands:
        try:
            r = replay(h, spec)
        except AssertionError as e:
            bad += 1
            print("ORDER MISMATCH", e)
            continue
        if r is None:
            skipped += 1
            continue
        if r != h["result"]:
            bad += 1
            print(f"RESULT MISMATCH hand {h['n']}: server {h['result']} ours {r}")
        else:
            ok += 1
    print(f"{ok} hands match, {bad} mismatches, {skipped} skipped (board not fully dealt in the log)")
    return bad


if __name__ == "__main__":
    sys.exit(1 if main(sys.argv[1], sys.argv[2]) else 0)
