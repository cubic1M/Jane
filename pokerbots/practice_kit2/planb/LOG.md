# Plan B rehearsal log (practice_kit2: Pocket Swap Hold'em)

| time (UTC) | milestone |
|---|---|
| 23:50:23 | start (read kit README, simkit, sample bots, prompts) |
| 23:51:19 | prompt 1 done: safe bot passes check_bot.py; 50 tables, 0 errors, 2 timeouts / 9792 decisions (0.02%, jitter; samples also time out) |
| 23:56:54 | prompt 2 done: build_tables.py ran 120 s on 4 procs (583,850 deals x 8 rotated heroes, all hands draw with the bot's own policy); 1183 preflop keys, 609 postflop keys; AA best for every k; 0 non-monotone k pairs; AA vs 1 = 0.798, 72o vs 1 = 0.429, 32o = 0.385 (draw compresses equities vs plain hold'em's 0.85 / 0.35); tables spliced into planb_bot.py (prompt 5's draw policy + flush-draw key built here, see notes) |
| 23:58:57 | prompt 3 done: full bot. 200 tables (seed 1): 337.3 pts/table, avg place 1.04, 196 wins, 0 errors, 10 timeouts / 50,915 decisions (jitter, incl. on_hand_end), slowest 2.35 ms; p99 (planb/p99.py, 50 tables) action 0.143 ms, draw 0.193 ms, on_hand_end 0.124 ms |
| 23:59:49 | prompt 5 done (draw): choose_discard() enumerates {keep both, drop card A, drop card B}, scores (category, flush/straight-draw, high card if nothing, n discarded); error path stands pat; built into the tables in prompt 2; planb/test_planb.py 16 tests OK; 200 tables 0 errors (see prompt 3 row) |
| 00:00:33 | prompt 4 debug mode done: `PLANB_DEBUG=1 python3 planb/debug_run.py --tables 100`: 24,984 decisions, 0 errors, 0 debug problems (pot rebuild, chip conservation, raise-by bounds); checks shown to fire on bad raises |
| 00:19:24 | prompt 4 A/B round 1 (ab.py, 800 paired tables per side, seed 1, timeouts off, all RNGs seeded): OPEN_BAR 1.18 -1.99+-1.86 reject; **OPEN_BAR 0.97 +3.99+-1.52 KEEP**; PUSH_EFF_BB 12 -0.36+-1.17 reject; PUSH_EFF_BB 6 +2.18+-0.93 keep?; CALL_MARGIN 0.03 -1.72+-1.56 reject; 0.09 -0.83+-0.68 reject. (Took 18 min, not the ~10 I guessed) |
| 00:26:59 | A/B round 2 on new base OPEN_BAR=0.97, fresh seed 2: PUSH_EFF_BB 6 +1.81+-0.92 (under 2 se: reject, one-at-a-time rule); DRAW_KICKER_MIN 10 -0.69+-1.59 reject. Final: only OPEN_BAR 1.07 -> 0.97 adopted |
| 00:28:01 | prompt 4 verification done (final bot): check_bot OK; 16 unit tests OK; debug run 100 tables 26,895 decisions 0 errors 0 problems; run_local 200 tables: planb_bot 333.0 pts, place 1.08, 196/200 wins, 0 errors, 12 timeouts / 54,292 (0.022%), slowest 5.27 ms, init 5.0 ms; shover 151.5, tight 99.9, caller 32.2 (tight 30 timeouts / 99,931, same jitter). p99 action 0.178 / draw 0.239 / on_hand_end 0.153 ms |

## Files (all under planb/)

- `planb_bot.py`: the submission (single file, check_bot.py OK, ~64 KB with tables)
- `build_tables.py`: offline Monte Carlo table builder (`--splice` pastes the tables into the bot)
- `tables_out.py`: last generated tables
- `p99.py`: decision-time percentiles (kit runner shows only mean and max)
- `debug_run.py`: prompt 4 debug mode (PLANB_DEBUG=1)
- `ab.py`: prompt 4 paired A/B harness
- `test_planb.py`: unit checks (`python3 -m unittest discover -s planb -p 'test_*.py'`)

## Where the prompts were ambiguous or wrong for this kit

Prompt 1
1. "the file name and the class name the README asks for ... its Agent interface": this kit has no
   Agent class and no fixed file name. It wants module-level `get_action(state)` (required), plus
   optional `init(config)` and `on_hand_end(summary)`, in any single `.py` file.
2. "go all-in (the kit's maximum raise-to value)": this kit's `amount` is a raise-BY over
   `current_bet`. All-in is `chips_total - current_bet`. There is no `allin` or `bet` action;
   opening a postflop bet is also `raise`.
3. "standard library, numpy and the kit modules only": wrong here. `simkit` is NOT on the grader,
   and only the listed modules are allowed (no `os`, `sys`, ...). The evaluator has to be copied in.
4. Time budget: the prompt's 0.3 ms target is self-imposed. The kit allows 1 ms, but its clock covers
   the JSON round trip of the whole state (history grows during a hand). `on_hand_end` is clocked too,
   and its overruns are counted as timeouts in the runner even though they do not affect play.
5. "my stack plus my chips already in front": in this kit that is `chips_total` already. It includes
   chips put in this round, but not chips from earlier rounds.
6. "Seed any random generator per table": `init` re-seeds the bot's own `random.Random`, from
   entropy by default and from module `SEED` when the A/B harness sets it.

Prompt 2
7. Cards are `"10H"` (ten = `10`, not `T`). Class keys use `T` internally (`"KTs"`).
8. Order conflict: prompt 5 says "use after prompt 1" but also says to rebuild prompt 2's table by
   simulating the draw. I built the draw-aware table directly in prompt 2 (every hand draws with the
   bot's own policy) and added prompt 5's flush-draw flag to the postflop key.
9. Flop key: the flop decision comes before the draw. The flop key is therefore my pre-draw category,
   and its value is the final share after everyone draws. Turn and river keys use post-draw cards.
10. The kit's `evaluate()` scores 5-7 cards only. On 4 cards (a kept card + 3-card flop) with four of
    a kind it raises (`max()` of an empty kicker list). It also cannot read a short board, and it is
    not importable on the grader. I wrote `category()` in the bot and checked it against the kit
    evaluator on 90k random 5/6/7-card hands (identical). The builder uses the kit evaluator only for
    showdowns.
11. The "done when" numbers are for plain hold'em and do not fit this variant. AA vs 1 = 0.798 (not
    0.85), and weak offsuit vs 1 = 0.385 (32o) to 0.43 (72o), not 0.35. The draw lets weak hands
    improve and compresses equities. AA best for every k and equity falling in k both hold (0
    violations). Oddity: 22 is the worst class at k = 2-4, because the policy never breaks a pair.
12. To get more samples I rotated the hero over all 8 hands of each deal (opponents = the next k
    hands). Samples within a deal are correlated, which does not matter for the means.

Prompt 3
13. `state["pot"]` in this kit EXCLUDES the current round's bets. The prompt's pot = `pot` + the sum
    of `chips_in_pot_this_round`.
14. "Track per seat, this table only": seats here are numbered from the button and renumber every hand
    (they close up after knockouts), and the state gives no ids. Per-seat stats would mix players.
    I keep a ring of ids clockwise from my own seat (id = offset from me) and drop knocked-out seats
    in `on_hand_end`. A unit test covers this.
15. "re-raise to 3 x the last raise-to amount" becomes raise-BY = 2 x `current_bet`. "open-raise to
    (2+limpers) bb" becomes raise-BY = (2+limpers) bb - `current_bet`.
16. Postflop raise facing a bet is unreachable: adjusted = equity x 0.6^bets must be >= 0.77, so a
    single bet needs equity >= 1.28. The bot never raises postflop when facing a bet.
17. "the category comes from the kit's evaluator": not available on the grader (see 10).
18. "players left at the table" read as `num_seats`. All-in blinds count as still in the pot for k.
    "limpers" = preflop callers before any raise, excluding me.
19. p99: the runner shows only mean and max, so I wrote `p99.py`, which wraps `BotAgent._call`.
20. "(the first bet counts)" implemented as 0.6^max(1, raises this street).

Prompt 5
21. Written for multi-card draw and board-discard variants. Its "done when" checks (five-card draw,
    A A 7 to the board) do not apply. Here it is discard 0 or 1 of 2 hole cards with a replacement,
    and a shared board. I replaced them with equivalent unit tests (keep a pocket pair or two pair,
    keep both cards of a flush draw, throw the off-suit card to a four-flush, throw the low card with
    nothing, keep a straight-draw card).
22. "on any error, discard the lowest-ranked cards (the minimum number allowed)": the minimum here is
    0, so the error path stands pat (also the kit's default). My first draft discarded the lowest
    card. Fixed.
23. "If it makes nothing" is ambiguous with a shared board: a paired board gives everyone a pair.
    I read it as category <= the board's own category. "highest single card" compares kept hole
    cards only.
24. Deviation: I apply the flush/straight-draw tiebreak whenever the category is below flush/straight,
    not only when the hand makes nothing. Otherwise 9h5h on 9c Kh 2h would throw the 5h (pair vs
    pair, "prefer discarding more") and break a flush draw.
25. "ignoring kickers ... prefer discarding more" throws away good kickers: seen in logs, it discards
    the A from [2C AS] on 6C 2H 4C and the Q from [AC QD] on AS 5H 2H. `DRAW_KICKER_MIN` (default 0 =
    as written) is an A/B candidate.
26. "Check the evaluator's code for high card first": in this kit high card = 0.

Prompt 4
27. "debug mode (environment variable)": the bot cannot import `os`. The module flag `DEBUG` is set
    by `debug_run.py`, which reads `PLANB_DEBUG`. Problems go to `DEBUG_LOG` and are never raised.
28. Chip check here: sum(`chips_total`) + `state["pot"]` == `starting_stack` x `num_players`
    (`chips_total` already includes this round's chips). The rebuilt pot must convert raise entries
    (amount = raise-BY) to chips put in: `to` - the seat's round bet so far.
29. "raise-to amounts within bounds" becomes raise-BY in [`min_raise_by`, `chips_total` -
    `current_bet`], where all-in may be below the minimum.
30. "copy the kit's random bot with a seed": `sample_caller` uses the global `random`, so `ab.py`
    seeds the global `random` and the bot's `SEED` per table. Identical A and B gave a paired
    difference of exactly 0.

## Bugs hit
- B1: the first draft of build_tables.py got the tie and share accounting wrong when growing k (it
  reset the tie count when a new best opponent appeared). Rewritten (beaten flag + count of equal
  scores) before the first run.
- B2: the draw error fallback discarded the lowest card, against "minimum number allowed" = 0.
  Fixed to stand pat.
- B3: kit `evaluate()` raises on 4-card quads (see 10). Avoided with the bot's own `category()`.
- B4: a test of mine expected flop trips to bet into 7 opponents, but table equity is 0.55 < 0.62.
  The test was wrong, not the bot (changed to heads-up).
- Timeouts: about 0.02% of calls go over 1 ms (single spikes of 1.1-4 ms, mostly in `on_hand_end`
  and the JSON of the state). The sample bots show the same rate, so this is machine jitter.
  p99.9 is 0.29-0.33 ms.

## A/B notes
- Ceiling effect: against the kit samples the bot already wins 98% of tables (max 350), so
  parameter gains are small and the sample field is a poor proxy for real opponents.
- Round 1 tested every candidate against the same base. Because the prompt says "one change at a
  time", PUSH_EFF_BB=6 was re-tested on top of the adopted OPEN_BAR on a fresh seed and failed the
  2-se bar there (+1.81 +- 0.92).
