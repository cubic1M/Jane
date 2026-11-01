# ORGANISER NOTES: do not hand out

This file is in a hidden folder (`.organiser/`), and README.md never
mentions it. Delete the folder before you zip the kit for participants.

Every gotcha below matches the README and the simulator. A careful reader
can avoid all of them. Each one names the README section that covers it
and the test that pins it down.

## Planted gotchas

1. **Raise is raise-BY, not raise-to.** (README 4.3; `test_betting.TestRaiseBy`)
   A bot that sends `{"action": "raise", "amount": 3 * bb}` for a "3x open"
   actually makes it 4x (20 + 60 = 80). If it sends a "raise to" figure
   facing a big bet, it nearly doubles its intended size. The
   `history[...]["amount"]` of a raise is also an increment. `to` is the
   total.

2. **`chips_total` includes this round's bet.** (4.2) The all-in raise-by is
   `chips_total - current_bet`, not `chips_total`. Chips left behind are
   `chips_total - chips_in_pot_this_round`. Bots that treat `chips_total` as
   "chips behind" overestimate their stack after a call or a blind, which
   matters mostly for the SB/BB in push/fold maths.

3. **`pot` excludes the current round.** (4.2) Pot odds computed from
   `pot` alone ignore every bet on this street, including the bet being
   faced. Preflop with no antes, `pot` is 0, so a bot dividing by it crashes
   (ZeroDivisionError, then fold).

4. **Ten is `"10"`.** (2) `card[0]` gives `"1"` for tens, and `card[1]` is
   `"0"`, not the suit. Rank tables keyed on `"T"` raise KeyError. Then the
   bot errors, folds (or checks), and keeps going quietly. On the draw,
   `{"discard": "TH"}` or `"10h"` is invalid, so the bot keeps both cards
   and gets an error. (`test_draw.test_invalid_discard_stands_pat`)

5. **Seat numbers move every hand and close up after knockouts.** (2)
   "Seat 3" is a different opponent each hand. Opponent models keyed on seat
   are noise. The only way to follow an opponent is to undo the rotation
   (the button moves one bot clockwise, and seats close up after a bust),
   which almost nobody does in 60 minutes. Heads-up, **the button is the
   small blind and acts first preflop**. Bots that hard-code "seat 1 = SB"
   or "seat 2 = BB" are wrong heads-up, and that is where the
   points are decided. (`test_betting.TestOrderAndSeats`)

6. **The draw changes your hole cards.** (3) A bot that caches
   `hole_cards` (or a preflop hand-strength score) in `init`/first call and
   reuses it on the turn/river evaluates the wrong hand. The sample tight
   bot re-reads on purpose. The comment says so.

7. **`get_action` is also called for the draw, with a different reply
   shape.** (3, 4.3) A bot that ignores `state["type"]` returns a betting
   action on the draw. That is invalid: it keeps both cards and logs an
   error. It is not a fold, so the bot never notices. Code that assumes `street in (preflop, flop, turn,
   river)` can crash on `"draw"`. **All-in bots are still asked.** A bot
   that returns early "because I'm all-in" without a `discard` key gives
   away free equity.

8. **The 1 ms includes JSON.** (5) Returning debug info in the reply
   (`{"action": ..., "debug": big_dict}`) costs time. numpy scalars
   (`np.int64(amount)`) and `float` amounts (`pot * 0.5`!) are errors, which
   means fold when facing a bet. `pot // 2` is fine, `pot / 2` is not.
   (`test_timing.test_not_json_serialisable_is_an_error`,
   `test_betting.test_bad_amounts_are_errors`)

9. **`check` facing a bet is a fold.** (4.3) Also `"bet"`, `"allin"`,
   `"Raise"`: none of them are actions. They are invalid, so the bot folds
   when facing a bet or checks when the check is free. The README spells
   this out, but people coming from other kits send `"bet"` or `"all_in"`.

10. **Undersized raises are rounded UP, oversize ones are cut to all-in.**
    (4.3) A bot that tries a "small probe raise" of 1 chip actually makes a
    full min-raise. One that raises when `can_raise` is false just calls,
    and that is not an error, so it may never notice (incomplete all-in
    re-raises: `test_betting.test_incomplete_all_in_does_not_reopen`).

11. **Antes from level 4 go into `pot`, not into
    `chips_in_pot_this_round`.** (1, 4.2) `to_call` is unaffected, but
    `chips_total` drops by the ante before the first decision, and the
    starting pot is no longer 0. Stack-to-pot and "BB in stack" maths that
    use `chips_total` at hand start are off slightly. Push/fold ranges
    should widen a lot from hand 76 (8 x 10 = 80 extra per pot at 50/100).

12. **Scoring is ICM at the cap, and the cap usually arrives.** (1) In
    testing with the sample bots, about 90% of tables reach hand 200,
    usually with 2-4 bots left. Chip-leading
    bots that keep gambling near hand 190 lose equity: ICM flattens the top
    prizes. A bot that just survives earns more than people expect. For
    simultaneous knockouts the larger **start-of-hand** stack ranks higher,
    so a short stack calling off against a bigger stack that is also all-in
    can still move up a place.

13. **Module state resets per table, and import time counts.** (4, 5) A
    per-tournament opponent model is impossible. Heavy module-level
    precomputation (e.g. building a 7-card lookup table, which can take
    seconds in pure Python) breaks the 500 ms init limit, and then **the bot sits out the
    whole table**. Locally this shows as `init fail` in the runner
    output, and the bot slowly loses to the blinds.

14. **Single file: `simkit` is not importable.** (6) `from simkit.cards
    import evaluate` works locally only if you skip `check_bot.py`. The
    checker and the submission form reject it, and so do `import os`/`sys`.
    The runner refuses to run a bot that fails the check (unless
    `--skip-check`).

15. **`on_hand_end` keys are strings.** (4.4) `summary["net"][my_seat]` is a
    KeyError, because the key is `"2"`. That error is only counted. It does
    not cost chips, so it is silent in play but shows in the error column,
    and any learning code that relies on it never learns anything.

## Rulings to give if asked on the day

* Number of tables: say "at least 20 per bot, mixed fields". Score = average
  points per table.
* Grader speed: "assume about 1.5x slower than a 2023 laptop".
* Repeated timeouts: never remove a bot. It just folds.
* Ties in final standings: more 1st places, then higher average place.
* "Can the draw discard both cards?" No: 0 or 1 (README 3).
* "Do discards get reshuffled?" No: dead (README 3).
* "Does the draw happen if I'm all-in?" Yes (README 3).
* "Is fold allowed when check is free?" Yes, accepted as a fold (README 4.3).
* "Why do I get random timeouts with an empty bot?" GC and OS jitter. The
  README says so (section 5). It is rare: about 1 in 5,000 decisions on the
  dev box.

## Checking the kit

```
cd practice_kit2
python3 -m unittest discover -s tests
python3 run_local.py --bot bots/template_bot.py --tables 20
```
