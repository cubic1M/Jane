"""Paired A/B: python3 planb/ab/ab.py TABLES SEED NAME=PARAM=VALUE ...
Each candidate is planb/bot.py with one constant changed; all sides use the same
--seed, seeded opponents and --no-timeouts, run in parallel."""
import os, re, subprocess, sys, statistics
KIT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
AB = os.path.join(KIT, "planb", "ab")
tables, seed = sys.argv[1], sys.argv[2]
src = open(os.path.join(KIT, "planb", "bot.py")).read()
sides = [("base", src)]
for spec in sys.argv[3:]:
    name, param, val = spec.split("=")
    new, n = re.subn(r"^%s = .*$" % param, "%s = %s" % (param, val), src, flags=re.M)
    assert n == 1, spec
    sides.append((name, new))
procs = []
for name, code in sides:
    path = os.path.join(AB, "cand_%s.py" % name)
    open(path, "w").write(code)
    cmd = [sys.executable, "run_local.py", "--bot", path, "--tables", tables, "--seed", seed,
           "--no-timeouts", "--no-logs", "--opponents", "bots/calling_station.py",
           os.path.join(AB, "tight_aggressive_seeded.py"), os.path.join(AB, "random_raiser_seeded.py")]
    procs.append((name, subprocess.Popen(cmd, cwd=KIT, stdout=subprocess.PIPE, text=True)))
pts = {}
for name, p in procs:
    out = p.communicate()[0]
    pts[name] = [float(m.group(1)) for m in re.finditer(r"^\s+T\d+ .* ([-\d.]+) pts", out, re.M)]
    err = re.search(r"errors\s+: (\d+)", out).group(1)
    print("%-8s mean %.3f over %d tables, errors %s" % (name, statistics.mean(pts[name]), len(pts[name]), err))
base = pts["base"]
for name, _ in sides[1:]:
    d = [a - b for a, b in zip(pts[name], base)]
    se = statistics.stdev(d) / len(d) ** 0.5
    print("%-8s diff %+.3f  SE %.3f  -> %s" % (name, statistics.mean(d), se,
          "KEEP" if statistics.mean(d) > 2 * se else "reject"))
