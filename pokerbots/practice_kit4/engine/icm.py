"""Malmuth-Harville ICM: expected points from chip stacks."""


def icm(stacks, payouts):
    """stacks: list of positive chip counts; payouts: points for places
    1..len(stacks) (best first). Returns expected points per stack."""
    n = len(stacks)
    if n == 0:
        return []
    pay = list(payouts[:n]) + [0] * (n - len(payouts))
    memo = {}

    def solve(mask):
        # equities of the players in mask for places len(done)+1 ...
        if mask in memo:
            return memo[mask]
        members = [i for i in range(n) if mask >> i & 1]
        place = n - len(members)
        eq = [0.0] * n
        total = sum(stacks[i] for i in members)
        if len(members) == 1:
            eq[members[0]] = pay[place]
        else:
            for i in members:
                p = stacks[i] / total
                eq[i] += p * pay[place]
                rest = solve(mask & ~(1 << i))
                for j in members:
                    if j != i:
                        eq[j] += p * rest[j]
        memo[mask] = eq
        return eq

    return solve((1 << n) - 1)
