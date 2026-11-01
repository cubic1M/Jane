"""ICM (Malmuth-Harville) calculator.

The chance a player finishes 1st is their share of the chips; given who
finished above them, the chance they finish next is their share of the
chips that are left.  This is exactly what the grader uses at the hand cap.

Pure Python, exact, fine for up to ~12 players.
"""


def icm_equities(stacks, prizes):
    """Expected prize for each stack.

    stacks: chip counts (all > 0).  prizes: prize for 1st, 2nd, ... (extra
    places beyond len(stacks) are ignored; missing places pay 0).
    """
    n = len(stacks)
    if n == 0:
        return []
    if any(s <= 0 for s in stacks):
        raise ValueError("ICM needs positive stacks")
    prizes = list(prizes)[:n] + [0] * max(0, n - len(prizes))
    total = sum(stacks)
    size = 1 << n
    used = [0] * size                 # chips held by the players in mask
    for mask in range(1, size):
        low = mask & -mask
        used[mask] = used[mask ^ low] + stacks[low.bit_length() - 1]
    prob = [0.0] * size               # P(players in mask fill the top places)
    prob[0] = 1.0
    places = [0] * size
    for mask in range(1, size):
        places[mask] = places[mask >> 1] + (mask & 1)
    eq = [0.0] * n
    for mask in range(size):
        p = prob[mask]
        if p == 0.0:
            continue
        k = places[mask]
        if k >= n:
            continue
        left = total - used[mask]
        for j in range(n):
            bit = 1 << j
            if mask & bit:
                continue
            q = p * stacks[j] / left
            prob[mask | bit] += q
            eq[j] += q * prizes[k]
    return eq


def finish_probabilities(stacks):
    """Matrix P[i][k] = probability that player i finishes in place k+1."""
    n = len(stacks)
    rows = []
    for k in range(n):
        prizes = [0] * n
        prizes[k] = 1
        rows.append(icm_equities(stacks, prizes))
    return [[rows[k][i] for k in range(n)] for i in range(n)]
