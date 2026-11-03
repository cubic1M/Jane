"""Paired comparison of two ab.py outputs: mean B - A and its standard error."""
import json
import math
import sys

a = json.load(open(sys.argv[1]))["points"]
b = json.load(open(sys.argv[2]))["points"]
d = [y - x for x, y in zip(a, b)]
n = len(d)
m = sum(d) / n
sd = math.sqrt(sum((x - m) ** 2 for x in d) / (n - 1))
se = sd / math.sqrt(n)
print(f"n={n} A={sum(a)/n:.2f} B={sum(b)/n:.2f} diff={m:+.2f} se={se:.2f} "
      f"-> {'KEEP' if m > 2 * se else 'reject'}")
