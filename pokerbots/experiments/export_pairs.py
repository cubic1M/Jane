"""Export every duplicate pair to results/pairs.csv (compact, committed evidence).
Columns: experiment, variant, a, b, seed, hands per match, A's bb/hand (both seats),
A's chips seat0, A's chips seat1."""
import csv

from experiments.common import RESULTS, RAW, ROOT, load_results


def main():
    out = RESULTS / "pairs.csv"
    with open(out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["experiment", "variant", "a", "b", "seed", "hands", "a_bb_per_hand", "a_chips_seat0", "a_chips_seat1"])
        for exp_dir in sorted(p for p in RAW.iterdir() if p.is_dir()):
            for r in load_results(exp_dir.name):
                s0, s1 = sum(r["a_deltas_seat0"]), sum(r["a_deltas_seat1"])
                n = len(r["a_deltas_seat0"]) + len(r["a_deltas_seat1"])
                w.writerow([exp_dir.name, r["variant"], r["a"], r["b"], r["seed"], r["hands"],
                            round((s0 + s1) / r["bb"] / n, 5), s0, s1])
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
