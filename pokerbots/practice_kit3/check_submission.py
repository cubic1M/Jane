#!/usr/bin/env python3
"""Check a bot file against the submission rules in README.md.

    python3 check_submission.py bots/template_bot.py
    python3 check_submission.py my_bot.py --no-smoke

Exit code 0 when every rule passes. The smoke test plays one short table
against the sample bots with the real time limits and reports problems.
"""

import argparse
import ast
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from engine import rules  # noqa: E402

REQUIRED_METHODS = ("on_action_request", "on_discard_request")


def static_check(path):
    """Return (failures, warnings) as lists of strings."""
    fails, warns = [], []
    if not path.endswith(".py"):
        fails.append("file name must end in .py")
    if not os.path.isfile(path):
        return ["file not found: %s" % path], warns
    with open(path, "rb") as f:
        data = f.read()
    if len(data) > rules.SUBMISSION_MAX_BYTES:
        fails.append("file is %d bytes; the limit is %d bytes"
                     % (len(data), rules.SUBMISSION_MAX_BYTES))
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return fails + ["file is not valid UTF-8"], warns
    try:
        tree = ast.parse(text, filename=path)
    except SyntaxError as e:
        return fails + ["syntax error: %s (line %s)" % (e.msg, e.lineno)], warns

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                top = alias.name.split(".")[0]
                if top not in rules.ALLOWED_IMPORTS:
                    fails.append("line %d: import of '%s' is not allowed" % (node.lineno, alias.name))
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                fails.append("line %d: relative imports are not allowed" % node.lineno)
            else:
                top = (node.module or "").split(".")[0]
                if top not in rules.ALLOWED_IMPORTS:
                    fails.append("line %d: import from '%s' is not allowed" % (node.lineno, node.module))
        elif isinstance(node, ast.Name) and node.id in rules.FORBIDDEN_NAMES:
            fails.append("line %d: use of '%s' is not allowed" % (node.lineno, node.id))
        elif isinstance(node, ast.Attribute) and (
                node.attr in rules.FORBIDDEN_NAMES or node.attr.startswith("__subclasses")):
            fails.append("line %d: attribute '%s' is not allowed" % (node.lineno, node.attr))

    agents = [n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "Agent"]
    if not agents:
        fails.append("no top-level class named exactly 'Agent'")
    else:
        cls = agents[-1]
        methods = {n.name: n for n in cls.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
        for m in REQUIRED_METHODS:
            if m not in methods:
                fails.append("Agent has no method %s" % m)
            elif isinstance(methods[m], ast.AsyncFunctionDef):
                fails.append("Agent.%s must not be async" % m)
        init = methods.get("__init__")
        if init is not None:
            a = init.args
            required = len(a.args) - 1 - len(a.defaults)
            if required > 0 or any(d is None for d in a.kw_defaults):
                fails.append("Agent.__init__ must be callable with no arguments")
        for m in ("on_table_start", "on_hand_start", "on_event", "on_showdown", "on_hand_end"):
            if m not in methods:
                warns.append("Agent has no %s (optional; it will simply not be called)" % m)
    return fails, warns


def smoke(path, hands):
    from engine.loader import load_factory, bot_name
    from engine.table import Table
    factory = load_factory(path)
    opps = [os.path.join(HERE, "bots", b) for b in
            ("calling_station.py", "tight_aggressive.py", "random_raiser.py")]
    entrants = [("SUBMISSION", factory)]
    for i in range(rules.SEATS - 1):
        p = opps[i % len(opps)]
        entrants.append((bot_name(p), load_factory(p)))
    res = Table(entrants, seed=12345, table_id="SMOKE", max_hands=hands).run()
    return [p for p in res["players"] if p["name"] == "SUBMISSION"][0], res["hands"]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("bot")
    ap.add_argument("--no-smoke", action="store_true")
    ap.add_argument("--hands", type=int, default=60)
    args = ap.parse_args(argv)

    fails, warns = static_check(args.bot)
    if not fails and not args.no_smoke:
        try:
            me, hands = smoke(args.bot, args.hands)
        except Exception as e:  # noqa: BLE001
            fails.append("smoke table crashed: %r" % (e,))
        else:
            if me["disabled"]:
                fails.append("bot could not be set up within budget: %s" % "; ".join(me["error_log"][:2]))
            if me["errors"]:
                warns.append("smoke table: %d errors, e.g. %s" % (me["errors"], me["error_log"][0]))
            if me["timeouts"]:
                warns.append("smoke table: %d timeouts (slowest %.3f ms)" % (me["timeouts"], me["max_charged_ms"]))
            print("smoke table: %d hands, %d decisions, slowest %.3f ms, setup %.1f ms"
                  % (hands, me["decisions"], me["max_charged_ms"], me["setup_ms"]))
    for w in warns:
        print("WARN  " + w)
    for f in fails:
        print("FAIL  " + f)
    print("RESULT: %s  (%s)" % ("PASS" if not fails else "FAIL", args.bot))
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
