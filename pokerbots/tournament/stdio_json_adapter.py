"""Adapter: run any of our bots behind a line-delimited JSON stdin/stdout protocol
(written for the rehearsal server in rehearsal/server/README.md; a template for
any JSON-over-pipes tournament protocol).

    OUR_BOT=adaptive+lp OUR_VARIANT=k_irish python3 tournament/stdio_json_adapter.py

Everything protocol-specific is in PROTOCOL. Self-checks print one-time warnings to
stderr (never stdout: stdout is the protocol channel, so sys.stdout is redirected to
stderr for the bot and its libraries).
"""
from __future__ import annotations

import json
import os
import sys
import traceback

sys.path.insert(0, os.environ.get("POKERBOTS_ROOT", os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from engine.cards import card_str, parse_card  # noqa: E402
from engine.game import (CALL, CHECK, DISCARD, FOLD, RAISE, ActionRecord, HandResult,  # noqa: E402
                         LegalActions, Observation)

PROTOCOL = dict(
    seat_of_sb=1,            # their seat number of the small blind / dealer (seat 0 = big blind)
    streets={"preflop": 0, "flop": 1, "turn": 2, "river": 3},
    raise_is_by=True,        # "raise N" = raise BY N on top of calling
)


def to_ours(c: str) -> int:
    return parse_card(c.replace("10", "T"))


def to_theirs(c: int) -> str:
    s = card_str(c)
    return ("10" + s[1]) if s[0] == "T" else s


def cards(xs) -> tuple:
    return tuple(to_ours(c) for c in xs)


class StdioAdapter:
    def __init__(self, bot_name: str, variant: str, out=None, log=None):
        from engine.variants import get_variant
        from experiments.common import make_bot
        self.spec = get_variant(variant)
        self.bot = make_bot(bot_name)
        self.out = out
        self.log = log or (lambda m: print(m, file=sys.stderr, flush=True))
        self.warned: set = set()
        self.errors = 0

    def warn(self, key, msg):
        if key not in self.warned:
            self.warned.add(key)
            self.log(f"[adapter] {msg}")

    def pos(self, seat: int) -> int:
        """Their seat -> our position (0 = small blind / dealer)."""
        return 0 if seat == PROTOCOL["seat_of_sb"] else 1

    # ---- history replay: their action texts -> our ActionRecords --------------------
    def history(self, actions) -> tuple:
        sp = self.spec
        street, bets, acted = 0, [0, 0], [False, False]
        # the k-th discard of a player belongs to the k-th discard rule (engine order: by
        # street); after an all-in no betting actions mark the street changes, so the
        # discard's street comes from the spec, not from the betting replay
        rules = sorted(sp.discards, key=lambda r: r.street)
        n_disc = [0, 0]
        out = []
        for seat, text in actions:
            p = self.pos(seat)
            o = 1 - p
            w = text.split()
            kind = w[0].lower()
            if kind == "post":
                bets[p] += int(w[1])
                continue
            if kind == "discard":
                k = n_disc[p]
                n_disc[p] += 1
                st = rules[k].street if k < len(rules) else max(street, 1)
                if st > street:
                    street, bets, acted = st, [0, 0], [False, False]
                out.append(ActionRecord(p, st, DISCARD, 0, cards(w[1:])))
                continue
            if kind == "fold":
                out.append(ActionRecord(p, street, FOLD, 0))
                continue
            if kind == "check":
                acted[p] = True
                out.append(ActionRecord(p, street, CHECK, 0))
            elif kind == "call":
                put = max(bets) - bets[p]
                bets[p] = max(bets)
                acted[p] = True
                out.append(ActionRecord(p, street, CALL, put))
            elif kind in ("raise", "bet"):
                n = int(w[1])
                to = max(bets) + n if PROTOCOL["raise_is_by"] else n
                bets[p] = to
                acted[p], acted[o] = True, False
                out.append(ActionRecord(p, street, RAISE, to))
            else:
                self.warn("unknown_action", f"unknown action text {text!r}")
                continue
            if acted[0] and acted[1] and bets[0] == bets[1]:
                street, bets, acted = min(street + 1, sp.num_streets - 1), [0, 0], [False, False]
        return tuple(out)

    def observation(self, m) -> Observation:
        sp = self.spec
        seat = m["seat"]
        opp = 1 - seat
        p = self.pos(seat)
        street = PROTOCOL["streets"][m["street"]]
        bets, stacks = m["bets"], m["stacks"]
        legal_words = set(m["legal"])
        rb = m.get("raise_by")
        hi_bet = max(bets)
        disc = m.get("discards") or [[], []]
        my_disc, opp_disc = cards(disc[seat]), cards(disc[opp])
        total_disc = sum(d.count for d in sp.discards)
        legal = LegalActions(
            can_fold="fold" in legal_words, can_check="check" in legal_words, can_call="call" in legal_words,
            call_amount=int(m.get("to_call", 0)), can_raise="raise" in legal_words and rb is not None,
            min_raise_to=hi_bet + int(rb[0]) if rb else 0, max_raise_to=hi_bet + int(rb[1]) if rb else 0,
            discard_count=int(m.get("discard_count") or 0) if m["phase"] == "discard" else 0)
        committed = [sp.starting_stack - stacks[0], sp.starting_stack - stacks[1]]
        hist = self.history(m.get("actions", []))
        # ---- self-checks ----------------------------------------------------------
        if m["pot"] != sum(committed):
            self.warn("pot", f"POT MAPPING? pot {m['pot']} vs committed {committed} (stack {sp.starting_stack})")
        if street == 0 and not any(r.kind in (CALL, RAISE, CHECK) for r in hist):
            want = sp.small_blind if p == 0 else sp.big_blind
            if bets[seat] != want:
                self.warn("blinds", f"BLIND MAPPING? our position {p} has bet {bets[seat]}, spec says {want}")
        if len(m["hole"]) + len(my_disc) != sp.hole_cards:
            self.warn("hole", f"HOLE COUNT? {len(m['hole'])} + {len(my_disc)} discarded vs spec {sp.hole_cards}")
        return Observation(
            hand_index=int(m["hand"]) - 1, hands_in_match=sp.hands_per_match, position=p, street=street,
            phase="discard" if legal.discard_count else "bet",
            my_cards=cards(m["hole"]), board=cards(m["board"]), my_discards=my_disc, opp_discards=opp_disc,
            opp_num_cards=sp.hole_cards - len(opp_disc), pot=int(m["pot"]),
            my_pip=int(bets[seat]), opp_pip=int(bets[opp]), my_stack=int(stacks[seat]), opp_stack=int(stacks[opp]),
            my_committed=committed[seat], opp_committed=committed[opp], legal=legal, history=hist,
            board_cards_to_come=sum(sp.board_cards_per_street[street + 1:]),
            my_discards_left=total_disc - len(my_disc), opp_discards_left=total_disc - len(opp_disc),
            bankroll=int(m.get("score", 0)), time_left=m.get("clock"), big_blind=sp.big_blind)

    def answer(self, m) -> str:
        legal_words = set(m["legal"])
        try:
            obs = self.observation(m)
            a = self.bot.act(obs)
            return self.translate(a, obs, m)
        except Exception:
            self.errors += 1
            self.warn("exc", "bot/adapter exception (playing safe):\n" + traceback.format_exc())
            if m["phase"] == "discard":
                return "discard " + " ".join(m["hole"][:int(m.get("discard_count") or 2)])
            return "check" if "check" in legal_words else "fold"

    def translate(self, a, obs, m) -> str:
        lg = obs.legal
        if lg.discard_count:
            if a.kind == DISCARD and len(a.cards) == lg.discard_count and all(c in obs.my_cards for c in a.cards):
                return "discard " + " ".join(to_theirs(c) for c in a.cards)
            self.warn("bad_discard", f"bot discard {a} not legal; discarding first cards")
            return "discard " + " ".join(m["hole"][:lg.discard_count])
        if a.kind == RAISE and lg.can_raise:
            to = lg.clamp_raise(a.amount)
            return f"raise {to - max(m['bets'])}"
        if a.kind == CALL and lg.can_call:
            return "call"
        if a.kind == CHECK and lg.can_check:
            return "check"
        if a.kind == FOLD:
            return "check" if lg.can_check else "fold"
        self.warn("illegal", f"bot returned {a} not legal here; playing safe")
        return "check" if lg.can_check else ("call" if lg.can_call else "fold")

    def hand_end(self, m):
        try:
            seat = m["seat"]
            p = self.pos(seat)
            hist = list(self.history(m.get("actions", [])))
            shown = m.get("shown")
            showdown = bool(m.get("showdown")) and shown is not None
            folded = m.get("folded")
            if folded is None and not showdown:
                # every hand ends in a fold or a showdown: the hand_end mapping is off
                self.warn("hand_end", f"HAND_END MAPPING? hand {m.get('hand')}: no fold and no showdown "
                                      f"(showdown={m.get('showdown')!r}, shown={shown!r}, folded={folded!r})")
            res = HandResult(position=p, delta=int(m["result"]), showdown=showdown,
                             my_cards=cards(shown[seat]) if showdown else (),
                             opp_cards=cards(shown[1 - seat]) if showdown else None,
                             board=cards(m.get("board", [])), history=tuple(hist),
                             folded_by=None if folded is None else self.pos(folded))
            self.bot.end_hand(res)
        except Exception:
            self.errors += 1
            self.warn("end", "end_hand exception:\n" + traceback.format_exc())

    def match_start(self, m):
        sp = self.spec
        checks = dict(small_blind=sp.small_blind, big_blind=sp.big_blind, stack=sp.starting_stack,
                      hole_cards=sp.hole_cards,
                      discard_count=sum(d.count for d in sp.discards))
        for k, want in checks.items():
            if k in m and m[k] != want:
                self.warn("ms_" + k, f"SPEC MISMATCH: server {k}={m[k]}, our spec {want}")
        # the server is the source of truth for the match length (lead protection uses it)
        if "hands" in m and m["hands"] != sp.hands_per_match:
            from dataclasses import replace
            self.spec = sp = replace(sp, hands_per_match=int(m["hands"]))
        self.bot.new_match(sp, int(os.environ.get("OUR_SEED", "0")))


def main():
    real_out = sys.stdout
    sys.stdout = sys.stderr            # nothing but answers may reach the protocol channel
    ad = StdioAdapter(os.environ.get("OUR_BOT", "adaptive+lp"), os.environ.get("OUR_VARIANT", "k_irish"))

    def send(s):
        real_out.write(s + "\n")
        real_out.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        m = json.loads(line)
        t = m.get("type")
        if t == "match_start":
            ad.match_start(m)
            send("ready")
        elif t == "act":
            send(f"{m['id']} {ad.answer(m)}")
        elif t == "hand_end":
            ad.hand_end(m)
        elif t == "match_end":
            try:
                ad.bot.end_match()
            except Exception:
                pass
            break


if __name__ == "__main__":
    main()
