#!/usr/bin/env python3
"""Static submission check: single file, allowed imports, get_action exists.

    python3 check_bot.py bots/my_bot.py

This is the same check the submission form runs.  Passing it does not mean
your bot is fast or correct - use run_local.py for that.
"""

import ast
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from simkit.rules import ALLOWED_IMPORTS, BANNED_NAMES, MAX_FILE_BYTES  # noqa: E402


def check_source(source, filename="<bot>"):
    """Return a list of problems (empty list = OK)."""
    problems = []
    if len(source.encode("utf-8")) > MAX_FILE_BYTES:
        problems.append(f"file is larger than {MAX_FILE_BYTES} bytes")
    try:
        tree = ast.parse(source, filename=filename)
    except SyntaxError as e:
        return problems + [f"syntax error: {e}"]
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                top = alias.name.split(".")[0]
                if top not in ALLOWED_IMPORTS:
                    problems.append(f"line {node.lineno}: import of "
                                    f"'{alias.name}' is not allowed")
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                problems.append(f"line {node.lineno}: relative imports are not "
                                f"allowed (single-file submission)")
            else:
                top = (node.module or "").split(".")[0]
                if top not in ALLOWED_IMPORTS:
                    problems.append(f"line {node.lineno}: import from "
                                    f"'{node.module}' is not allowed")
        elif isinstance(node, ast.Name) and node.id in BANNED_NAMES:
            problems.append(f"line {node.lineno}: use of '{node.id}' is not "
                            f"allowed")
        elif isinstance(node, ast.Attribute) and node.attr.startswith("__") \
                and node.attr in ("__import__", "__builtins__", "__subclasses__",
                                  "__globals__", "__code__"):
            problems.append(f"line {node.lineno}: use of '{node.attr}' is not "
                            f"allowed")
    funcs = {n.name for n in tree.body
             if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
    if "get_action" not in funcs:
        problems.append("no module-level function get_action(state)")
    for name in ("get_action", "init", "on_hand_end"):
        for n in tree.body:
            if isinstance(n, ast.AsyncFunctionDef) and n.name == name:
                problems.append(f"{name} must be a plain def, not async def")
    return problems


def check_file(path):
    path = Path(path)
    if path.suffix != ".py":
        return [f"{path.name}: submission must be a single .py file"]
    return check_source(path.read_text(encoding="utf-8"), str(path))


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    status = 0
    for p in argv[1:]:
        problems = check_file(p)
        if problems:
            status = 1
            print(f"FAIL {p}")
            for msg in problems:
                print(f"  - {msg}")
        else:
            print(f"OK   {p}")
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv))
