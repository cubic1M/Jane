# Plan B5 log

## Timeline (UTC)
- 03:37:00 start
- 03:37:21 safe bot passes check_submission.py; 50 tables seed 7: 45.60 pts, 0 errors, 0 timeouts
- 03:41:33 strength tables built (build_tables.py, 120 s x 4 cores, 2,969,500 deals; AA vs 1 = 0.751, best class AA for every k, monotone in k for all 81 classes and 73 postflop groups)
- 03:41:47 full decision rules done (bot.py assembled, 22.7 KB; own category() matches kit evaluator on 200,000 random 5-7 card hands); debug harness 100 tables seed 11: 0 debug problems, 0 errors, p99 0.054 ms
- 03:42:00 verification done: run_local 50 tables seed 7 -> 70.69 pts, 0 errors, 0 timeouts; 200 tables seed 3 -> 66.59 pts, 0 errors, 0 timeouts

Time to a verified bot: 03:37:00 -> 03:42:00 = **5 minutes** (safe bot at 0.3 min,
tables at 4.5 min, full bot at 4.8 min, verification at 5.0 min).

## Files
- `bot.py` the submission (single file, 22.7 KB, stdlib only; tables embedded)
- `bot_src.py` the same code with a `#TABLES#` placeholder; `bot.py` = it + `tables_out.py`
- `build_tables.py` prompt 2 Monte Carlo (kit evaluator, 4 processes, 120 s) -> `tables_out.py`
- `test_category.py` the bot's own category() vs the kit evaluator (200,000 random hands, 0 mismatches)
- `harness.py` prompt 4 debug mode (sets `bot.DEBUG = True` after import; no env vars) + p99 timer
- `run50_seed7.txt` the final 50-table run

## Final run_local table (`python3 run_local.py --bot planb5/bot.py --tables 50 --seed 7`)

```
bot                     seats  avg pts  place  wins errors timeouts benched decisions  avg ms  max ms
YOU: PlanB5                50    70.69   2.22    31      0        0       0      8356  0.0227   0.211
calling station            59    10.59   6.19     0      0        0       0      3960  0.0003   0.014
holdem habit               59    40.22   3.73     3      0        0       0      7280  0.0096   0.136
random clicker             58    10.34   6.19     1      0        0       0      1603  0.0007   0.015
rock                       58    42.07   3.33     0      0        0       0      7208  0.0024   0.026
shove monkey               58    27.89   5.14    10      0        0       0      2210  0.0018   0.052
sixplus shark              58    44.14   3.59     5      0        1       0      7435  0.0102   1.207

your places: 1:31 2:2 3:3 4:5 5:7 6:2 7:0 8:0
```

Also: 200 tables seed 3 -> 66.59 pts (samples 8.6-46.0), 0 errors, 0 timeouts, max 0.469 ms;
debug harness 100 tables seed 11 -> 69.06 pts, 0 debug problems, p50 0.027 ms, p99 0.054 ms,
max 0.394 ms. Safe bot alone (prompt 1): 45.60 pts on 50 tables seed 7.
Not done: prompt 4's paired A/B tuning (between-rounds work; nothing was tuned).

## Ambiguities and errors in the prompts (`report/sng_codex_prompt.md`)

1. **Line 3 and Prompt 1 lines 55-56** ("the `Agent` interface file", "the file name and the class
   name the README asks for", "implementing its Agent interface"): kit 4 has no class, no Agent file and
   no required file name: it is module functions `NAME`, `play(view, memory)`, `setup(rules)`. Assumed
   that; `bots/template_bot.py` was the nearest thing to an "interface file".
2. **Prompt 1 line 60** "all-in (the kit's maximum raise-to value)": kit 4's reply is neither raise-to
   nor raise-by but *chips to add now*; the maximum is `view["max_add"]`. The kit-2 lesson (raise-by)
   does not cover this third convention. Assumed: return `max_add`; every raise-to target T becomes
   add = T - my bet this street, at least `min_add`, at most `max_add`.
3. **Prompt 1 line 59 / Prompt 3 lines 94-95** "chips already in front": this street's bet or the hand
   total? Used this street's `bet` (identical preflop, where prompt 1 applies).
4. **Prompt 1 line 62** "standard library, numpy and the kit modules only" and **Prompt 3 line 90**
   "the category comes from the kit's evaluator": README says `engine/` is not importable by the bot
   (and `os`/`sys` are banned). Wrote an own `category()` and checked it (0 mismatches / 200,000). The
   kit-2 lesson says this, but prompt 3's text still contradicts it.
5. **Prompt 1 line 62** "Seed any random generator per table": no table id in the view. Seeded
   `random.Random` with a string of (my seat, first button, first hole cards) at the table's first
   decision and kept it in `memory` (string seeds are stable; no `hash()`).
6. **Prompt 2 lines 74-75** board category "by rank counts when the board has under 5 cards": which
   category numbers? Used the kit's numbering (pair 1, two pair 2, trips 4, quads 7; in Six-Plus trips
   is code 4, above straight). With 5 board cards it is unstated; used the full evaluator (flush/straight).
7. **Prompt 2 line 76** "Print the tables as Python dict literals": tuple-keyed dicts would be bulky;
   printed compact dicts instead (preflop class -> 7 ints x1e4 for k=1..7; postflop int key
   street*1000+cat*100+boardcat*10+k -> int x1e4). 8.5 KB; well under the 64 KB cap.
8. **Prompt 2 "Done when"**: the Six-Plus target is "Short deck: AA = 0.76"; got 0.751 vs 1. The
   "weak offsuit hand = 0.35" is a hold'em number; here the weakest class 76o = 0.349, by luck the same.
9. **Prompt 3 lines 96-97** "players still to act": unclear whether all-in opponents count (excluded:
   they cannot act) and whether limpers count as still to act after a raise (counted as callers, 0.8).
10. **Prompt 3 line 100** open rate needs "hands dealt": only the previous hand is visible
    (`last_hand`) and the bot is not called at hand end. If I am never called in a hand (a walk in the
    big blind), the hand before it is lost from the stats. Accepted the rare gap.
11. **Prompt 3 lines 109-110** fold-to-open rate "folds when facing an open raise": defined as each
    seat's first action after the first raise, up to and including the second raise; whether a caller in
    between changes "facing an open raise" is unstated (ignored).
12. **Prompt 3 line 111** "players behind": taken as players still to act (blinds included).
13. **Prompt 3 lines 117-121** attacked-opens lock: gated on "the deck has all 52 cards", so it is off
    in Six-Plus (36 cards). Implemented but disabled through `setup(rules)["deck"]`. "1st does not take
    most of the points" has no threshold (here 100 of 275, so it would pass).
14. **Prompt 3 line 124** re-shove "one open, no callers": limpers before the open allowed? Assumed yes
    (only calls after the open block it).
15. **Prompt 3 lines 128-129** kf "+0.8 for each opponent who already called or raised": does the
    raiser count? Assumed not (the base 4 is the raiser).
16. **Prompt 3 lines 130-136** "re-raised ALL-IN": judged from the re-raiser's status `allin`. On
    heads-up tables the base is 2, so "min(4, k(c))" became min(base, k(c)). Line 133 "facing exactly one
    open" vs line 135 "first action after a lone open": treated as the same counter.
17. **Prompt 3 line 136** "Interpolate equity linearly between integer k" sits inside the re-shoved
    bullet, but kf is fractional in every facing-a-raise case (0.2/0.8 terms); applied it everywhere,
    clamped to 1..7.
18. **Prompt 3 line 138** "3 x the last raise-to amount": in kit-4 units add = 3 x highest bet this
    street - my bet. If re-raising is not allowed (`min_add` None) fall through to the call rule (unstated).
19. **Prompt 3 line 140** "players left at the table": seats not `out`, me included (assumed).
20. **Prompt 3 line 146** "my stack" for the 50% test: chips behind before the call (`max_add`).
21. **Prompt 3 lines 147-148** "As the preflop raiser, heads-up on the flop, bet half the pot 55% of the
    time": preflop raiser = the last preflop raiser; when the 55% draw fails, does the stab rule still
    apply? Assumed check.
22. **Prompt 3 lines 149-150** "their postflop fold-to-bet rate" with 2 opponents: averaged them.
23. **Prompt 3 "Done when"** "wrap `decide` in a small timer that prints p99": `time` is banned in the
    submission and prints are discarded; the timer lives in `harness.py` instead.
24. **Prompt 4 line 159** "harness flag": implemented as module global `DEBUG` set by the harness after
    import; problems go to a list (prints are discarded by the kit).
25. **Prompt 4 lines 163-164** chip conservation: kit 4's `pot` already includes all streets, so the
    check is sum over all 8 seats of stack + total = 2000 x 8 (out seats are 0). Added a third check:
    the sum of chip amounts in `log` equals `pot`.
26. **Prompt 4** paired A/B: `run_local.py` gives same-seed tables and seeds `random` itself, so pairing
    by `--seed` works; `--no-timeouts` replaces "raise the time limit". Not run (no tuning done).
27. Prompt 5 does not apply (no discard or draw phase).

## Kit-4 interface points the prompts did not prepare me for
- The reply is **chips to add now**; anything below `owe` (including 0) folds, and a non-int
  (bool, float) is an error, so every reply is cast with `int()`.
- `min_add` is `None` when raising is not allowed (short all-in did not reopen): raise targets
  must fall back to call/check.
- `street` is an integer; seats are fixed 1..8 with `seats[k-1]`; statuses `in/allin/folded/out`.
- Opponent actions come only as the `log` string (`<seat><code><chips>`, `!` suffix, `|cards` street
  marks), and `last_hand` covers just one hand, delivered at my next decision.
- Over-time folds even when a check was free; 3 timeouts in a row bench the seat; `time` is banned,
  so the bot cannot watch its own clock.
- Module globals are shared between seats and tables: all per-table state lives in `memory`.
