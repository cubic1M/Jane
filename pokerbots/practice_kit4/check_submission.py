#!/usr/bin/env python3
"""Check a submission against the rules in README section 6.

    python3 check_submission.py bots/my_bot.py
Exit status 0 = accepted, 1 = rejected.
"""
import argparse
import ast
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from engine import rules   # noqa: E402


def static_problems(path):
    """Return a list of rule violations found without running the file."""
    if not path.endswith(".py"):
        return ["the file name must end in .py"]
    if not os.path.isfile(path):
        return [f"no such file: {path}"]
    size = os.path.getsize(path)
    if size > rules.MAX_FILE_BYTES:
        return [f"file is {size} bytes; the limit is {rules.MAX_FILE_BYTES}"]
    try:
        src = open(path, encoding="utf-8").read()
        tree = ast.parse(src, filename=path)
    except (UnicodeDecodeError, SyntaxError) as e:
        return [f"cannot parse: {e}"]
    out = []
    names = {}
    for node in tree.body:
        if isinstance(node, ast.FunctionDef):
            names[node.name] = node
        elif isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name):
                    names[t.id] = node
    name = names.get("NAME")
    if not (isinstance(name, ast.Assign) and isinstance(name.value, ast.Constant)
            and isinstance(name.value.value, str)):
        out.append('missing a top-level NAME = "..." string')
    else:
        v = name.value.value
        if not (1 <= len(v) <= rules.NAME_MAX_CHARS and v.isprintable()):
            out.append(f"NAME must be 1-{rules.NAME_MAX_CHARS} printable characters")
    for fn, nargs in (("play", 2), ("setup", 1)):
        node = names.get(fn)
        if node is None:
            if fn == "play":
                out.append("missing a top-level def play(view, memory)")
            continue
        if not isinstance(node, ast.FunctionDef):
            out.append(f"{fn} must be a plain top-level def")
            continue
        a = node.args
        if len(a.posonlyargs) + len(a.args) != nargs or a.vararg or a.kwonlyargs or a.kwarg:
            out.append(f"{fn} must take exactly {nargs} positional parameter(s)")
    for node in ast.walk(tree):
        line = getattr(node, "lineno", "?")
        if isinstance(node, ast.Import):
            for alias in node.names:
                top = alias.name.split(".")[0]
                if top not in rules.ALLOWED_IMPORTS:
                    out.append(f"line {line}: import {alias.name} is not allowed")
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                out.append(f"line {line}: relative imports are not allowed")
            elif node.module.split(".")[0] not in rules.ALLOWED_IMPORTS:
                out.append(f"line {line}: from {node.module} import ... is not allowed")
        elif isinstance(node, ast.Name) and node.id in rules.FORBIDDEN_NAMES:
            out.append(f"line {line}: {node.id} is not allowed")
        elif (isinstance(node, ast.Attribute) and node.attr.startswith("__")
              and node.attr.endswith("__") and node.attr not in rules.ALLOWED_DUNDER_ATTRS):
            out.append(f"line {line}: attribute {node.attr} is not allowed")
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("bot")
    ap.add_argument("--tables", type=int, default=3, help="smoke tables (default 3)")
    args = ap.parse_args(argv)

    problems = static_problems(args.bot)
    for p in problems:
        print("REJECT: " + p)
    if problems:
        return 1
    print("static checks: ok")

    import run_local
    from engine.seats import BotFile, rules_dict
    bot = BotFile(args.bot, rules_dict())
    if bot.load_error:
        print(f"REJECT: {bot.load_error}")
        return 1
    print(f"import + setup: {bot.setup_ms:.1f} ms (limit {rules.SETUP_LIMIT_MS:.0f} ms)")
    me = run_local.run(run_local.parse_args(
        ["--bot", args.bot, "--tables", str(args.tables), "--seed", "424242", "--quiet"]))
    if me.errors:
        print(f"REJECT: {me.errors} errors in the smoke tables (see above)")
        return 1
    if me.timeouts:
        print(f"WARNING: {me.timeouts} timeouts in the smoke tables; "
              "the event folds every one of them")
    print(f"ACCEPTED: {args.bot} ({os.path.getsize(args.bot)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
