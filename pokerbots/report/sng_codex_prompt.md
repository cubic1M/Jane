# Plan B: prompts for Codex during the build (from-scratch rebuild of `icm_lite`)

Paste these in order. Before each, give Codex the kit's README and the `Agent` interface
file. Each prompt asks for one testable piece. Check the "done when" line before moving
on. (These prompts are our own notes about our strategy. Check with the organisers
that bringing written notes is fine.)

## Prompt 1 (minutes 5–10): safe bot
> Write `submission/bot.py` implementing the kit's Agent interface. `decide()` must never
> raise and must return within 0.3 ms: wrap everything in try/except returning check if
> checking is legal, else fold. Strategy for now: check when free; fold to any bet;
> when my stack is at most 10 big blinds and nobody has raised, go all-in (use the kit's
> maximum raise-to value) with pocket pairs 77+, AK, AQ, AJs; otherwise fold. Do not
> import any of my own files; standard library, numpy and the kit modules only.

Done when: the kit's local runner shows 0 errors and 0 timeouts on 50 tables. **Submit.**

## Prompt 2 (minutes 10–20): strength tables
> Write `build_tables.py` that uses the kit's evaluator (with the variant's deck and hand
> ranking) to Monte Carlo, for 120 seconds, eight random hands plus a full board per deal.
> For each deal and each k = 1..7, hero = hand 0, opponents = hands 1..k; hero's share =
> 1 if it beats all, 1/ties if tied for best, else 0. Accumulate the mean share keyed by
> (a) preflop: the hero's starting-hand class (two ranks high-first + 's'/'o'/'p') and k;
> (b) on the flop, turn and river: (street, hero's best-hand category, the category the
> visible board alone makes (by rank counts if under 5 cards), k). Keep keys with ≥ 20
> samples. Print the table as a Python dict literal I can paste into bot.py.

Done when: AA vs 1 is about 0.85 (hold'em), 72o vs 1 about 0.35, and equity falls as k rises.

## Prompt 3 (minutes 20–40): decision rules
> In bot.py, embed the tables as dicts and implement `equity(hole, board, k)`: preflop
> from the class table; postflop from (street, my category, board category, k), with the
> category from the kit's evaluator (computed once per hand per street and cached).
> Effective stack in big blinds = min(my stack + my chips in front, the largest stack +
> chips in front among opponents still in the hand). Rules, parameters as constants:
> * Preflop, no raise yet: k = players still to act + limpers. Track per seat (this
>   table only) how often each player folds when facing an open raise
>   (rate = (folds + 1) / (opens faced + 2)). If at most 5 players are behind and there
>   are no limpers, multiply the bar by 1 − 0.55·max(0, 2·(their fold rate) − 1), using
>   the players behind (only the blinds if ≤ 2 behind).
>   * If eff ≤ 9 bb: all-in if equity(k) ≥ (0.75 + 0.25·eff/9) / (k+1), else check or fold.
>   * Else open-raise to (2 + limpers) bb if equity(k) ≥ 1.07/(k+1) × the bar factor,
>     else check or fold.
> * Facing a raise: the raiser counts as 4 random hands, +0.8 per extra player in the
>   pot; interpolate equity between integer k. If equity ≥ 0.62: all-in when eff ≤ 24 bb,
>   else raise to 3× the last raise. Else call if equity ≥ call/(pot+call) + 0.06
>   (+ 0.10·(1 + 0.15·(8 − players left)) when the call is all-in or over 40% of my
>   stack), else fold.
> * Postflop: k = opponents still in. Facing a bet: equity × 0.6 per raise this street;
>   raise pot-size if adjusted equity ≥ max(0.77, need + 0.25); call if ≥ need (same
>   formula as preflop, ICM premium when the call is ≥ 50% of my stack); else fold.
>   Not facing a bet: bet 65% of the pot if equity ≥ 0.62; as the preflop raiser heads-up
>   on the flop, bet half the pot 55% of the time; otherwise check.
> * Never fold when checking is free. Pot = all chips in the middle, current bets included.

Done when: 0 errors, p99 < 0.3 ms, and average points clearly above the kit's sample bots
on 200 tables. **Submit.**

## Prompt 4 (minutes 40+): verify, then tune between rounds
> Add a debug mode that asserts, every decision: pot equals the sum of all players'
> chips put in this hand; stacks plus chips in front sum to the starting total; my
> raise-to amounts are within the kit's bounds. Run 100 tables with it on.

Then between scored rounds, A/B one change at a time on the same seeds (the kit's runner
with `--seed`): push depth 9 → 6/12, open bar 1.07 → 0.97/1.18, calling margin
0.06 → 0.03/0.09. Keep a change only if it wins clearly on 400+ tables.
