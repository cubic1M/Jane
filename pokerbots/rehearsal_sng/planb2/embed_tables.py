"""Paste PRE/POST from tables_out.py into bot.py between the TABLES markers."""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
tables = open(os.path.join(HERE, "tables_out.py")).read()
pre = next(l for l in tables.splitlines() if l.startswith("PRE = "))
post = next(l for l in tables.splitlines() if l.startswith("POST = "))
path = os.path.join(HERE, "bot.py")
src = open(path).read()
a = src.index("# ---- TABLES BEGIN\n") + len("# ---- TABLES BEGIN\n")
b = src.index("# ---- TABLES END")
src = src[:a] + pre + "\n" + post + "\n" + src[b:]
open(path, "w").write(src)
print("embedded", len(pre), len(post), "chars")
