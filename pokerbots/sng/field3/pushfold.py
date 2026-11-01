"""Chip accounting and ICM expected value for preflop all-in decisions
(single-caller approximation: the first player who calls is the only one)."""
from __future__ import annotations


def push_ev(obs, callers, U, eq_vs, call_width):
    """ICM EV (points) of moving all-in now, vs U(fold) the caller compares with.

    callers: seats that may call, in the order they act; eq_vs(x) = my equity vs the
    top-x of hands; call_width(j, risk_bb) = fraction of hands seat j calls with."""
    seats = obs.seats
    bb = max(1, obs.big_blind)
    my_total = obs.my_stack + obs.my_bet
    p_none = 1.0
    ev = 0.0
    for j in callers:
        sj = seats[j].stack + seats[j].bet
        if sj <= 0:
            continue
        X = min(my_total, sj)
        c = min(1.0, max(0.0, call_width(j, X / bb)))
        if c <= 0:
            continue
        e = eq_vs(c)
        dead = obs.pot - obs.my_bet - seats[j].bet
        win = my_total + X + dead
        lose = my_total - X
        pc = p_none * c
        ev += pc * (e * U(win) + (1 - e) * U(lose))
        p_none *= 1 - c
    steal = my_total + obs.pot - obs.my_bet
    ev += p_none * U(steal)
    return ev


def call_outcomes(obs, j):
    """(win_chips, lose_chips, fold_chips) if I call the all-in of seat j now."""
    lg = obs.legal
    seats = obs.seats
    call_amt = lg.call_amount
    mine_in = obs.my_bet + call_amt
    their_in = min(seats[j].bet, mine_in)
    dead = obs.pot - obs.my_bet - seats[j].bet
    win = obs.my_stack - call_amt + mine_in + their_in + dead
    lose = obs.my_stack - call_amt
    return win, lose, obs.my_stack


def interp(x, xs, ys):
    if x <= xs[0]:
        return ys[0]
    for i in range(1, len(xs)):
        if x <= xs[i]:
            t = (x - xs[i - 1]) / (xs[i] - xs[i - 1])
            return ys[i - 1] + t * (ys[i] - ys[i - 1])
    return ys[-1]


# Nash-flavoured defaults: how wide a typical player calls a shove risking r big blinds,
# and how wide a player with s big blinds shoves.
CALL_X = (2, 4, 6, 8, 10, 15, 20, 30, 50)
CALL_Y = (0.70, 0.45, 0.32, 0.25, 0.20, 0.14, 0.11, 0.08, 0.05)
SHOVE_X = (2, 4, 6, 10, 15, 20, 30, 50)
SHOVE_Y = (0.85, 0.60, 0.45, 0.32, 0.22, 0.15, 0.10, 0.05)


def default_call_width(risk_bb):
    return interp(risk_bb, CALL_X, CALL_Y)


def default_shove_width(stack_bb):
    return interp(stack_bb, SHOVE_X, SHOVE_Y)
