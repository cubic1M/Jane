"""Independent Chip Model (Malmuth-Harville) calculator.

The tournament uses this module to split the remaining points between the bots
still seated when a table reaches the hand cap.

    python3 kit/icm.py 5200 3100 1700 --payouts 100 70 50
"""

import argparse
from collections import defaultdict

import numpy as np

MAX_PLAYERS = 12


def finish_probabilities(stacks) -> np.ndarray:
    """P[i, k] = probability that player i finishes in place k + 1.

    Each next-highest place goes to a remaining player with probability
    proportional to their stack. Players with zero chips only take places
    once every player with chips is placed (then uniformly at random).
    """
    s = np.asarray(stacks, dtype=float)
    n = len(s)
    if n > MAX_PLAYERS:
        raise ValueError(f"at most {MAX_PLAYERS} players")
    if (s < 0).any():
        raise ValueError("stacks must be non-negative")
    probs = np.zeros((n, n))
    layer = {(1 << n) - 1: 1.0}
    for place in range(n):
        nxt: dict[int, float] = defaultdict(float)
        for mask, p in layer.items():
            members = [i for i in range(n) if mask >> i & 1]
            total = s[members].sum()
            for i in members:
                w = s[i] / total if total > 0 else 1.0 / len(members)
                if w == 0.0:
                    continue
                probs[i, place] += p * w
                nxt[mask & ~(1 << i)] += p * w
        layer = nxt
    return probs


def icm_equity(stacks, payouts) -> list[float]:
    """Expected payout for each player given stacks and payouts by place.

    payouts[0] is the prize for 1st. Extra places get 0; extra payouts beyond
    the number of players are ignored.
    """
    n = len(stacks)
    pay = np.zeros(n)
    k = min(n, len(payouts))
    pay[:k] = np.asarray(payouts[:k], dtype=float)
    return (finish_probabilities(stacks) @ pay).tolist()


def main() -> None:
    parser = argparse.ArgumentParser(description="ICM equity calculator")
    parser.add_argument("stacks", type=float, nargs="+")
    parser.add_argument("--payouts", type=float, nargs="+", required=True,
                        help="prize for 1st, 2nd, ...")
    args = parser.parse_args()
    eq = icm_equity(args.stacks, args.payouts)
    total = sum(args.stacks)
    for i, (st, e) in enumerate(zip(args.stacks, eq)):
        print(f"player {i}: stack {st:>10.0f} ({st / total:6.1%})  equity {e:8.3f}")


if __name__ == "__main__":
    main()
