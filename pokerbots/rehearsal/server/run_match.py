#!/usr/bin/env python3
"""Plays one match between two bot commands and reports chips per bot.

    python3 run_match.py --bot1 "python3 example_bot.py" --bot2 "python3 example_bot.py" \
        --hands 1000 --seed 7 [--log match.log]

Bots are subprocesses speaking line-delimited JSON (see README.md).
bot1 is the dealer on odd-numbered hands, bot2 on even-numbered hands.
"""
from __future__ import annotations

import argparse
import json
import os
import queue
import subprocess
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import poker  # noqa: E402

STARTUP_GRACE = 30.0    # seconds to answer "ready"; not charged to the time bank
_EOF = object()


class BotProcess:
    def __init__(self, name: str, cmd: str, action_timeout: float, time_bank: float, stderr_path: str):
        self.name, self.cmd = name, cmd
        self.action_timeout, self.clock = action_timeout, time_bank
        self.dead = False
        self.stats = {"decisions": 0, "timeouts": 0, "illegal": 0, "auto": 0, "stray_lines": 0,
                      "max_think": 0.0}
        self._err = open(stderr_path, "w")
        self.proc = subprocess.Popen(cmd, shell=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=self._err, text=True, bufsize=1)
        self.lines: queue.Queue = queue.Queue()
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self) -> None:
        for line in self.proc.stdout:
            self.lines.put(line)
        self.lines.put(_EOF)

    def send(self, msg: dict) -> None:
        if self.dead:
            return
        try:
            self.proc.stdin.write(json.dumps(msg, separators=(",", ":")) + "\n")
            self.proc.stdin.flush()
        except (BrokenPipeError, OSError, ValueError):
            self.dead = True

    def _drain(self) -> None:
        """Discards lines nobody asked for (debug prints, late answers, replies to info messages)."""
        while True:
            try:
                line = self.lines.get_nowait()
            except queue.Empty:
                return
            if line is _EOF:
                self.dead = True
                return
            self.stats["stray_lines"] += 1

    def ask(self, msg: dict, limit: float) -> tuple[str | None, float]:
        """Sends a request; returns (reply line or None on timeout/crash, seconds taken)."""
        self._drain()
        if self.dead:
            return None, 0.0
        self.send(msg)
        t0 = time.perf_counter()
        try:
            line = self.lines.get(timeout=max(limit, 0.0))
        except queue.Empty:
            line = None
        took = time.perf_counter() - t0
        if line is _EOF:
            self.dead, line = True, None
        return (line.strip() if line is not None else None), took

    def handshake(self, msg: dict) -> bool:
        reply, _ = self.ask(msg, STARTUP_GRACE)
        return reply is not None and reply.lower() == "ready"

    def decide(self, msg: dict) -> tuple[str | None, str]:
        """Returns (reply, note). Out of time bank or crashed: the server checks, else folds."""
        if self.dead or self.clock <= 0:
            self.stats["auto"] += 1
            if msg["phase"] == "discard":
                return "discard " + " ".join(msg["hole"][:poker.DISCARD_COUNT]), "AUTO"
            return ("check" if "check" in msg["legal"] else "fold"), "AUTO"
        msg = {**msg, "clock": round(self.clock, 3)}
        limit = min(self.action_timeout, self.clock)
        reply, took = self.ask(msg, limit)
        self.clock -= took
        self.stats["decisions"] += 1
        self.stats["max_think"] = max(self.stats["max_think"], took)
        if reply is None:
            self.stats["timeouts"] += 1
            return None, f"TIMEOUT {took:.3f}s" + (" (process ended)" if self.dead else "")
        return reply, ""

    def close(self) -> None:
        try:
            self.proc.stdin.close()
        except OSError:
            pass
        try:
            self.proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait()
        self._err.close()


def play_match(bot1_cmd: str, bot2_cmd: str, hands: int, seed: int, log_path: str,
               action_timeout: float = poker.ACTION_TIMEOUT, time_bank: float = poker.TIME_BANK) -> dict:
    base = os.path.splitext(log_path)[0]
    bots = [BotProcess("bot1", bot1_cmd, action_timeout, time_bank, base + ".bot1.stderr"),
            BotProcess("bot2", bot2_cmd, action_timeout, time_bank, base + ".bot2.stderr")]
    score = [0, 0]
    log = open(log_path, "w")
    log.write(f"# match seed={seed} hands={hands} bot1={bot1_cmd!r} bot2={bot2_cmd!r}\n")
    try:
        for i, b in enumerate(bots):
            ok = b.handshake({"type": "match_start", "you": b.name, "hands": hands,
                              "small_blind": poker.SMALL_BLIND, "big_blind": poker.BIG_BLIND,
                              "stack": poker.STACK, "hole_cards": poker.HOLE_CARDS,
                              "discard_count": poker.DISCARD_COUNT,
                              "action_timeout": action_timeout, "time_bank": time_bank})
            log.write(f"# {b.name} handshake {'ok' if ok else 'MISSING (no ready line)'}\n")
        for h in range(1, hands + 1):
            dealer = 0 if h % 2 == 1 else 1                  # index into bots
            by_seat = [bots[1 - dealer], bots[dealer]]      # seat 0 = big blind, seat 1 = dealer
            hand = poker.Hand(h, poker.shuffled_deck(seed, h))
            for s, b in enumerate(by_seat):
                b.send({"type": "hand_start", "hand": h, "seat": s, "hole": poker.strs(hand.hole[s]),
                        "score": score[bots.index(b)]})
            notes: list[str] = []

            def decide(seat, msg):
                b = by_seat[seat]
                reply, note = b.decide({**msg, "score": score[bots.index(b)]})
                if note:
                    notes.append(f"  {b.name}(seat {seat}) {msg['street']} {msg['phase']}: {note}")
                return reply

            deltas = hand.play(decide)
            for s, b in enumerate(by_seat):
                score[bots.index(b)] += deltas[s]
                b.send({**hand.end_message(s, deltas), "score": score[bots.index(b)]})
            for s, reply in hand.illegal:
                if reply is not None:
                    by_seat[s].stats["illegal"] += 1
                    notes.append(f"  {by_seat[s].name}(seat {s}) ILLEGAL reply {reply[:80]!r} -> fold")
            _log_hand(log, hand, by_seat, deltas, score, notes)
        for i, b in enumerate(bots):
            b.send({"type": "match_end", "hands": hands, "score": score[i]})
    finally:
        for b in bots:
            b.close()
        log.close()
    assert sum(score) == 0, "chips not conserved"
    return {"score": score, "stats": [b.stats for b in bots], "clock_left": [b.clock for b in bots],
            "log": log_path}


def _log_hand(log, hand, by_seat, deltas, score, notes) -> None:
    seat_name = [f"{by_seat[0].name}(BB,seat0)", f"{by_seat[1].name}(D/SB,seat1)"]
    log.write(f"Hand {hand.hand_no}: {seat_name[1]} vs {seat_name[0]}\n")
    for s in (1, 0):
        orig = sorted(hand.hole[s] + hand.discards[s], key=lambda c: (c % 13, c // 13))
        log.write(f"  {seat_name[s]} dealt {' '.join(poker.strs(orig))}\n")
    for seat, text in hand.actions:
        log.write(f"  {by_seat[seat].name}: {text}\n")
    log.write(f"  board {' '.join(poker.strs(hand.board))}\n")
    for line in notes:
        log.write(line + "\n")
    if hand.showdown:
        for s in (0, 1):
            log.write(f"  {by_seat[s].name} shows {' '.join(poker.strs(hand.hole[s]))}: "
                      f"{poker.CATEGORIES[hand.values[s][0]]}\n")
    log.write(f"  result {by_seat[0].name} {deltas[0]:+d}, {by_seat[1].name} {deltas[1]:+d}"
              f" | match {score[0] if by_seat[0].name == 'bot1' else score[1]:+d} for bot1\n")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bot1", required=True, help="shell command that starts bot 1")
    ap.add_argument("--bot2", required=True, help="shell command that starts bot 2")
    ap.add_argument("--hands", type=int, default=poker.HANDS_PER_MATCH)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--log", default=None, help="hand log path (default logs/match_seed<S>.log)")
    ap.add_argument("--action-timeout", type=float, default=poker.ACTION_TIMEOUT,
                    help="seconds per decision (testing only; the event uses the default)")
    ap.add_argument("--time-bank", type=float, default=poker.TIME_BANK,
                    help="seconds per bot per match (testing only; the event uses the default)")
    a = ap.parse_args(argv)
    log_path = a.log or os.path.join("logs", f"match_seed{a.seed}.log")
    os.makedirs(os.path.dirname(os.path.abspath(log_path)), exist_ok=True)
    t0 = time.time()
    r = play_match(a.bot1, a.bot2, a.hands, a.seed, log_path, a.action_timeout, a.time_bank)
    print(f"match: {a.hands} hands, seed {a.seed}, {time.time() - t0:.1f}s wall")
    for i, cmd in enumerate((a.bot1, a.bot2)):
        st = r["stats"][i]
        print(f"bot{i + 1} {r['score'][i]:+d} chips  ({cmd})")
        print(f"     decisions {st['decisions']}, timeouts {st['timeouts']}, illegal {st['illegal']}, "
              f"auto {st['auto']}, stray lines {st['stray_lines']}, slowest {st['max_think']:.3f}s, "
              f"time bank left {r['clock_left'][i]:.1f}s")
    s1 = r["score"][0]
    print("winner:", "bot1" if s1 > 0 else "bot2" if s1 < 0 else "draw")
    print("hand log:", log_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
