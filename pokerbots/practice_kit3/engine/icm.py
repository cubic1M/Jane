"""Independent Chip Model (Malmuth-Harville) equity for a list of stacks.

icm_equities([5000, 3000, 2000], [12, 7, 4]) -> expected points per player.
payouts[i] is the value of finishing (i+1)th among these players; it is padded
with zeros or truncated to len(stacks). Payouts may be negative.
"""


def icm_equities(stacks, payouts):
    n = len(stacks)
    pay = list(payouts[:n]) + [0] * max(0, n - len(payouts))
    if n == 0:
        return []
    memo = {}

    def solve(mask):
        # equities for players in mask competing for places (n - popcount(mask))..
        if mask in memo:
            return memo[mask]
        members = [i for i in range(n) if mask >> i & 1]
        place = n - len(members)
        res = [0.0] * n
        if not members:
            memo[mask] = res
            return res
        total = sum(stacks[i] for i in members)
        for j in members:
            pj = stacks[j] / total if total > 0 else 1.0 / len(members)
            if pj == 0:
                continue
            res[j] += pj * pay[place]
            if len(members) > 1:
                sub = solve(mask & ~(1 << j))
                for i in members:
                    if i != j:
                        res[i] += pj * sub[i]
        memo[mask] = res
        return res

    return solve((1 << n) - 1)
