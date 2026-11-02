# Plan B rehearsal on practice kit 3 ("Pitch Hold'em")

| time (UTC) | milestone |
|---|---|
| 03:56:02 | start (read README, prompts, engine) |
| 03:57:00 | prompt 1 done: safe bot planb/bot.py passes check_submission; 50 tables seed 1: 6.45 pts, 0 errors, 0 timeouts, slowest 0.026 ms (snapshot planb/bot_safe.py) |
| 04:00:54 | prompt 2 (+ prompt 5 strength part) done: planb/build_tables.py simulated the variant 120 s on 4 cores, 707,250 deals x 8 rotated heroes; AA best class for every k (0.839 vs 1 ... 0.369 vs 7), every PRE row and every POST (street,cat,boardcat,fd) row falls with k; J4o vs 1 = 0.378, 53o = 0.311; 12 never-kept classes (32o, 42o, ...) missing; category() matches kit evaluator on 200k random 5-7 card hands |
| 04:01:41 | prompt 3 done: full bot planb/bot.py (= bot_core.py + tables_out.py, 27,925 bytes) passes check_submission; 200 tables seed 2: **10.800 pts** (114 firsts, 2 eighths) vs tight_aggressive 4.495, random_raiser 0.291, calling_station 0.011; 0 errors, 1 timeout (1.183 ms charged, 0.012 ms in the call: notification/GC jitter; TAG got one at 3.8 ms too), slowest call 0.978 ms; harness p99 0.050 ms |
| 04:01:41 | prompt 4 debug run: planb/debug_harness.py (DEBUG via harness flag) 100 tables seed 3, no-timeouts: 10.277 pts, 0 errors over 23,116 decisions with asserts on (pot == sum contributed == sum of history amounts; sum(stack+contributed) == 16000; my stack/bet/to_call match players list; 8,797 raises all on 0.5 bb steps, > current bet, >= min_raise_to); p50 0.018 / p99 0.050 / p99.9 0.089 ms |
| 04:03:18 | prompt 4 done: paired A/B (planb/ab/ab.py: same --seed 777, seeded copies of TAG and random_raiser, --no-timeouts, 400 tables/side): OPEN_BAR 1.18 +0.228 (SE 0.155) reject; OPEN_BAR 0.97 +0.229 (SE 0.165) reject; base kept. Final: check_submission PASS; 200 tables seed 4: **10.346 pts**, 107 firsts, 1 eighth, 0 errors, 0 timeouts, slowest 0.464 ms charged / 0.238 ms call; kit unittests OK |

## Final results (planb/bot.py, 200 tables vs the kit's sample bots, real 1 ms limit)

| run | my avg pts | TAG | random_raiser | calling_station | errors | timeouts | slowest charged |
|---|---|---|---|---|---|---|---|
| safe bot, 50 tables, seed 1 | 6.450 | 5.878 | 0.757 | 0.016 | 0 | 0 | 0.026 ms |
| full bot, seed 2 | 10.800 | 4.495 | 0.291 | 0.011 | 0 | 1 (jitter) | 1.183 ms (0.012 in call) |
| full bot, seed 4 (final) | 10.346 | 4.521 | 0.429 | 0.041 | 0 | 0 | 0.464 ms |

Points per table sum to 22 (fair share 2.75; max 12).

## Where the prompts were ambiguous or wrong for this kit

1. **Raise convention.** Kit 3 is raise-TO in **big blinds** ("r <x>", street total, rounded to
   0.5 bb half-up), not chips (kit 1) or raise-by (kit 2). Every chip amount must be divided by
   bb. "All-in = the kit's maximum raise-to" must be rounded **up** to a 0.5 bb step, otherwise
   the engine can round it down below max_raise_to (184 chips at bb 20 -> 9.2 -> 9.0 bb = 180,
   not all-in). The template's helper uses Python round() (banker's) while the engine rounds
   half-up: they disagree on exact halves. I used ceil to 0.5 bb everywhere.
2. **Three hole cards.** Prompt 1's push list (77+, AK, AQ, AJs) and prompt 2's class key
   ("two ranks + s/o/p") assume two cards. Matched "any two of the three" in prompt 1.
3. **Imports.** Prompt 1 says "standard library, numpy and the kit modules": here numpy and kit
   modules are banned; only 13 listed modules; names like open/compile/eval are banned even as
   attributes. hash(str) is randomised per process, so it is no good as a per-table seed.
4. **Size limit (32,000 bytes) is not in the prompts.** Prompt 5's 3-card preflop key (pair
   structure, top, second, max suit, run) gives ~2,000 classes x 7 k: it does not fit as dict
   literals, and the key is ambiguous (which two cards are paired/suited). Used instead the
   kept two-card class (169 x 7, variant-simulated) and preflop equity = max over the three
   possible discards. Tables are fixed-width digit strings (3,549 + 10,206 chars); bot is
   27,925 bytes.
5. **Prompt 5 discard rule.** "Keep the set with the best hand using the kit's evaluator" does
   not work: the discard is preflop, the evaluator needs 5-7 cards. Chose the discard that
   maximises the variant table's two-card equity vs the number of opponents left. Its "AA7
   throws the 7" check is for discards to the board; here discards are dead, but it holds
   anyway (As Ah 7s -> 7s). The draw checks (five-card draw) do not apply.
6. **Ordering.** Prompt 5 says "use this after prompt 1", the task says "in order"; prompt 2's
   note says to build the table by simulating the variant. Did the strength part in prompt 2
   and the discard policy in prompt 3.
7. **Simulation policy.** Prompt 5 says simulate "with this same policy for all players", but
   the table must exist before the bot's table-based policy: used a fixed keep heuristic in the
   simulation. 12 two-card classes (32o, 42o, ...) are never kept, so they are missing.
8. **Plausibility numbers.** Prompt 2's hold'em AA vs 1 ~ 0.85: in this variant it is 0.839
   (opponents keep their best two of three); weak offsuit kept hands 0.31-0.38.
9. **Prompt 3 definitions.** No antes here; the kit's pot already includes every street. "The
   preflop raiser" taken as the last preflop raiser. kf = 4 + 0.8*(n-1) reaches 8.8 > 7:
   clamped to 7; postflop k clamped to 7. "No raise yet ... else check or fold" means the SB
   never completes and limps are folded: followed literally. "Players still to act" built from
   this street's history (blinds count until they act); all-in blinds count as opponents.
10. **Points table.** 12/7/4/2/0/0/0/-3 with ICM split at hand 200 (57 of 200 tables reached
    the cap). The ICM premium "0.10*(1+0.15*(8 - players left))" was tuned for other tables;
    kept unchanged.
11. **Positions/ids.** Positions are names; players list is button-first; ids are random
    strings fixed per table: kit-2's "track by relative position" lesson does not apply; per-id
    stats work.
12. **Timing.** Limit is 1 ms with notification time charged to the next decision. The runner
    shows only slowest and "slowest call alone"; p99 needs the harness. One timeout in 44k
    decisions was 1.18 ms charged with 0.012 ms in the call (GC/jitter in a notification); the
    kit's own TAG also timed out.
13. **Debug checks.** "Stacks + chips in hand sum to start x players" works because the players
    list covers every live player (busted ones hold 0); hard-coded 16,000 is 8-seat only.
14. **A/B pairing.** The kit's TAG and random bot both use unseeded random.Random() and Agent()
    gets no arguments: seeded copies seed from on_table_start (table_id + your_id). The table
    RNG is only used for setup and shuffles, so decks pair across sides. 400 tables per side
    (rehearsal cap, prompt says >= 800): both candidates +0.23 +- 0.16, below 2 SE.

## Bugs hit

- build_tables.py summary print crashed (KeyError '72o': a class the discard policy never keeps);
  the table file had already been written. Fixed the print list; bot falls back for missing classes.
- Debug raise-bound assert was written as a no-op ("... or True"); caught before the debug run.
- First seed used hash(str) (randomised per process); replaced before the first run.
- No errors from the bot in any run (0 errors over ~135k decisions incl. 23k with asserts on).

## Files
planb/bot.py (submission) = bot_core.py + tables_out.py; bot_safe.py (prompt 1 snapshot);
build_tables.py (+ .out); test_category.py; debug_harness.py; ab/ (A/B script, seeded opponents).
