#!/usr/bin/env python3
"""Test bots that break the rules on purpose. Usage: misbehaving_bot.py MODE

    garbage   answers every request with text that is not an action
    sleep     sleeps longer than the per-action limit on every 3rd request
    crash     exits after 5 decisions
    chatty    prints a debug line on stdout before each answer and answers info messages
    maniac    raises the maximum whenever it can (forces all-ins), else checks/calls
    silent    never says "ready", then plays like maniac
"""
import json
import sys
import time

mode = sys.argv[1]
n = 0
for line in sys.stdin:
    msg = json.loads(line)
    if msg["type"] == "match_start":
        if mode != "silent":
            print("ready", flush=True)
        continue
    if msg["type"] == "match_end":
        break
    if msg["type"] != "act":
        if mode == "chatty":
            print("thanks for the hand", flush=True)
        continue
    n += 1
    if mode == "garbage":
        print("I raise you a cookie", flush=True)
        continue
    if mode == "sleep" and n % 3 == 0:
        time.sleep(float(sys.argv[2]) if len(sys.argv) > 2 else 1.5)
    if mode == "crash" and n > 5:
        sys.exit(3)
    if mode == "chatty":
        print("debug: thinking...", flush=True)
    if msg["phase"] == "discard":
        reply = "discard " + " ".join(msg["hole"][:msg["discard_count"]])
    elif "raise" in msg["legal"]:
        reply = f"raise {msg['raise_by'][1]}"
    else:
        reply = "check" if "check" in msg["legal"] else "call"
    print(f"{msg['id']} {reply}", flush=True)
