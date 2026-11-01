# Plan B: prompts for Codex during the build (from-scratch rebuild of `icm_lite`)

Paste these in order. Before each, give Codex the kit's README and the `Agent` interface
file. Each prompt asks for one testable piece. Check the "done when" line before moving
on. (These prompts are our own notes about our strategy. Check with the organisers
that bringing written notes is fine.)

**Rehearsed** (`rehearsal_sng/planb/LOG.md`): a fresh agent with only a fake kit and
these prompts had a verified bot in **15 minutes**:

| minute | milestone |
|---|---|
| 2 | safe bot |
| 5 | tables |
| 9 | full bot |
| 15 | verification |

It scored 79.5 points per table vs the kit's sample bots (our full bot: 78–85), with
0 errors. This version folds in the 15 ambiguities it reported.

## Prompt 1 (minutes 0–5): safe bot
> Write the kit's submission file (the file name and the class name the README asks
> for) implementing its Agent interface. Every decision must never raise and must return
> within 0.3 ms: wrap everything in try/except returning check if checking is legal, else
> fold. Strategy for now: check when free; fold to any bet. When my stack plus my chips
> already in front is at most 10 big blinds and nobody has raised (limps are not raises),
> go all-in (the kit's maximum raise-to value) with pocket pairs 77+, AK, AQ, AJs;
> otherwise fold. Single self-contained file: standard library, numpy and the kit
> modules only. Seed any random generator per table.

Done when: the kit's local runner shows 0 errors on 50 tables. Rare timeouts (under 0.1%
of decisions) can be machine jitter: even the kit's own bots get them. **Submit.**

## Prompt 2 (minutes 5–10): strength tables
> Write `build_tables.py` (offline; multiprocessing is fine) that uses the kit's
> evaluator, with the variant's deck and hand ranking, to Monte Carlo for 120 seconds:
> eight random hands plus a full board per deal. For each deal and each k = 1..7,
> hero = hand 0 and opponents = hands 1..k; hero's share = 1 if it beats them all,
> 1/(number tied) if tied for best, else 0. Accumulate the mean share keyed by:
> (a) preflop: the hero's starting-hand class (two ranks high-first + 's'/'o'/'p') and k;
> (b) flop, turn, river: (street, hero's best-hand category, the category the visible
> board alone makes (by rank counts when the board has under 5 cards), k).
> Keep keys with ≥ 20 samples. Print the tables as Python dict literals I can paste into the
> bot. In the bot, look up a missing postflop key by averaging the same (street, category, k)
> over board categories, then fall back to 1/(k+1).

Done when: AA is the best class for every k; equity falls as k rises for every key;
AA vs 1 ≈ 0.85 in hold'em (≈ 0.76 in short deck); a weak offsuit hand vs 1 ≈ 0.35.

## Prompt 3 (minutes 10–25): decision rules
> In the bot, embed the tables as dicts and implement `equity(hole, board, k)`. Preflop,
> use the class table. Postflop, use (street, my category, board category, k); the
> category comes from the kit's evaluator, computed once per street and cached.
> Definitions:
> * pot = all chips in the middle including the current street's bets and antes;
> * "my stack" = chips behind;
> * effective stack (bb) = min(my stack + my chips in front, the largest stack + chips in
>   front among opponents not folded) / big blind;
> * "players still to act" = opponents not folded who have not acted voluntarily this
>   street (the blinds count until they act).
>
> Rules, with the parameters as named constants:
> * **Preflop, no raise yet.**
>   - k = players still to act + limpers.
>   - Track per seat, this table only, how often it folds when facing an open raise:
>     rate = (folds + 1) / (opens faced + 2).
>   - If 1 to 5 players are behind and there are no limpers, let f = the average rate of
>     the players behind, and steal factor = 1 − 0.55·max(0, 2f − 1).
>   - If eff ≤ 9 bb: all-in if equity(k) ≥ (0.75 + 0.25·eff/9) / (k+1); else check or
>     fold. (The steal factor does not apply here.)
>   - Else: open-raise to (2 + limpers) bb if equity(k) ≥ 1.07/(k+1) × steal factor;
>     else check or fold.
> * **Facing a raise.**
>   - The raiser counts as kf = 4 random hands, + 0.8 for each other opponent still in
>     the hand (not folded) beyond one. Interpolate equity linearly between integer k.
>   - Re-raise if equity × (kf + 1) ≥ RERAISE: all-in when eff ≤ 24 bb, else raise to
>     3 × the last raise-to amount. RERAISE is 99, i.e. off: never re-raise, only call or
>     fold. (Being validated: 2.6, roughly AA only.)
>   - Else call if equity ≥ call/(pot + call) + 0.06, plus 0.10·(1 + 0.15·(8 − players
>     left at the table)) when the call puts me all-in or is over 40% of my stack.
>   - Else fold.
> * **Postflop,** k = opponents not folded.
>   - Facing a bet: adjusted equity = equity × 0.6 per bet or raise this street (the
>     first bet counts). Pot-size raise if adjusted ≥ max(0.77, need + 0.25). Call if
>     adjusted ≥ need, where need = call/(pot+call) + 0.06, plus the ICM premium above
>     when the call is ≥ 50% of my stack. Else fold.
>   - Not facing a bet: bet 65% of the pot if equity ≥ 0.62. As the preflop raiser,
>     heads-up on the flop, bet half the pot 55% of the time. Otherwise check.
> * Never fold when checking is free.

Done when: 0 errors; p99 < 0.3 ms (the kit runner shows only the slowest and mean, so
wrap `decide` in a small timer that prints p99); clearly above the kit's sample bots on
200 tables. **Submit.**

## Prompt 4 (minutes 25+): verify, then tune between rounds
> Add a debug mode (environment variable) that checks every decision: my rebuilt pot equals
> the sum of all players' chips put in this hand (antes and earlier streets included);
> stacks + this hand's chips + anything else in the middle sum to the starting total
> × players; my raise-to amounts are within the kit's bounds. Run 100 tables with it on.

Then between scored rounds, A/B one change at a time, **paired**:
- same seeds, with every random generator seeded (copy the kit's random bot with a seed if
  it has none);
- the time limit raised for the A/B runs, so a jitter timeout does not change a table;
- ≥ 800 tables per side; keep a change only if its mean gain > 2 standard errors of the
  paired difference.

Candidates in order of expected value: open bar 1.07 → 1.18 / 0.97; push depth
9 → 12 / 6; calling margin 0.06 → 0.03 / 0.09.
