# Organiser notes (do not hand out before the rehearsal ends)

Variant: **Six-Plus Hold'em** (short deck, 36 cards, flush > full house,
three of a kind > straight, A-6-7-8-9 straight, antes from level 3).

Everything below is documented truthfully in README.md; each item is a place
where a team in a hurry is likely to slip. "Symptom" says how it shows up in
`run_local.py` output or the hand log.

## Planted gotchas

1. **Raise amount is raise-TO, not raise-BY.** `Action.raise_(amount)` takes
   the street total (`Action.amount`, README section 8). The helper is called
   `raise_`, not `raise_to`, and the field is just `amount`, so it reads like
   an increment. A bot that passes "pot-sized raise" as an increment gets a
   much smaller raise, and anything below `min_raise_to` is *silently clamped
   up* to the minimum (no error is counted).
   Symptom: log shows `RAISE` lines with `asked N, raised to minimum`.

2. **`stack` excludes `committed`.** A player's total chips for this street is
   `stack + committed`; all-in is `max_raise_to`, not `stack`. A bot that
   shoves `Action.raise_(obs.me.stack)` while it has a blind or a bet in front
   of it raises to less than all-in (or gets clamped to the min-raise).

3. **`to_call` is not capped by your stack.** It can exceed `me.stack`; pot
   odds computed as `to_call / (pot + to_call)` overstate the price for short
   stacks. When `stack <= to_call`, `"raise"` is not legal.

4. **`obs.pot` excludes the current round's bets** (only earlier streets plus
   antes), while the hand log's `pot` column *includes* them. Pot odds and
   bet sizing from `obs.pot` alone are wrong on every street after a bet;
   you need `obs.pot + sum(p.committed for p in obs.players)`. Teams who
   calibrate against the log will be off by the current bets.

5. **Card spelling and deck.** Ten is `T`, suits lower-case; there are no
   2-5 cards. Equity code built on a 52-card deck (or copy-pasted evaluators
   with 13 ranks, `"10h"`, upper-case suits, etc.) is wrong or crashes on
   import/first call. Preflop hand charts from normal hold'em are badly off
   (pairs and suited hands are worth relatively more/less; dominated
   draws are common).

6. **Changed hand ranking.** Flush beats full house; three of a kind beats a
   straight; `A 6 7 8 9` is a straight (nine-high, the lowest), there is no
   `A 2 3 4 5`. A team that uses its own evaluator with standard ranks will
   misjudge strength. Note: in a single 7-card hand you can never hold both a
   flush and a full house, so the swap only matters between players; trips
   vs straight *can* coexist (e.g. `6 6 6 7 8 9 T` scores as trips).

7. **`players` is indexed by seat and always has 8 entries.** Your seat is
   random (not 0), the button is a seat number, and eliminated bots stay in
   the tuple with `status="out"` and `stack=0`. Counting `len(obs.players)`
   as "players left", or computing position as `(seat - button) % 8` without
   skipping `out` seats, gives wrong positions late in the table. Folded
   players also keep their `stack`/`committed` values (status `"folded"`).

8. **Heads-up blind order.** With two bots left the button posts the small
   blind and acts first preflop, last postflop (README section 5). Bots that
   assume `small_blind_seat == next seat after button` misread heads-up.

9. **Antes are dead money.** From hand 51 (level 3) every dealt-in player
   posts an ante before the blinds. Antes are in `obs.pot` and in `history`
   (`kind="ante"`), but *not* in `committed` and *not* in `to_call`; the
   big blind's `committed` is only the big blind. Bots computing "chips
   invested this hand" from `committed` alone miss them; antes also make
   stealing more profitable from level 3 on.

10. **Level boundaries.** Levels change at hands 26, 51, 76, ... (1-based
    hand numbers, 25 hands each), and level 8 (150/300/25) runs to hand 200.
    Off-by-one in `(hand_number) // 25` versus `(hand_number - 1) // 25`.

11. **Illegal-action fallbacks are asymmetric.** `check` facing a bet is a
    *fold* (not an error, not a call). `call` when free is a check. `raise`
    when not legal becomes a call. A bot that returns `check` meaning "check
    or call" folds every time it faces a bet.
    Symptom: `illegal check -> fold` notes in the log; errors stay 0.

12. **A short all-in does not reopen the betting.** After an all-in for less
    than a full raise, players who already acted cannot re-raise; `"raise"`
    is missing from `legal_actions` and `min_raise_to`/`max_raise_to` are 0.
    Bots that assume raising is always possible (or compute their own min
    raise as `2 * to_call`) get converted to a call. The minimum raise is the
    last *full* raise increment, not twice the current bet.

13. **Timing is wall-clock around `decide()` only, and includes everything
    inside it.** A fresh `Bot()` is created per table; `__init__` is untimed
    (1 s), but lazy setup on the first `decide()` call (building lookup
    tables, first numpy call, imports inside the function) is timed. GC
    pauses count too; even the sample `pusher_bot` occasionally exceeds
    1 ms on a GC pause. Exceptions formatted with tracebacks are cheap for
    the engine (formatted after the clock stops), but printing inside
    `decide()` is not. Over the limit the action is discarded: fold, or check
    if free.
    Symptom: `TIMEOUT` lines (lazy setup shows up on the first decision of each table) and a
    "slowest decision" above 1 ms.

14. **Module state differs between local and tournament.** Locally
    `run_local.py` loads the file once and plays all tables in one process,
    so module-level caches/globals persist across tables (and make the first
    table slower than the rest). In the tournament each table is a fresh
    process: anything built at import or in module globals is rebuilt per
    table, and per-instance opponent models reset per table anyway.

15. **Points table order and ICM.** `config.POINTS_BY_FINISH` (and the
    README table) is listed from 8th place up to 1st, so
    `POINTS_BY_FINISH[place - 1]` is backwards (use `points_for_place`). The
    table is top-heavy but 8th gets 0 and 7th only 5, so busting first is
    expensive; survivors at hand 200 are paid by ICM, so doubling a big
    stack is worth much less than doubling a small one. Same-hand busts are
    ranked by chips at the *start* of the hand; equal starting stacks share.

## Minor details (not counted as gotchas)

- Odd chips go to the first winner clockwise from the button.
- A short big blind still makes the others call the full big blind.
- `hand_over()` has a 1 ms limit but overruns have no game effect.
- The button moves to the next *live* seat (no dead button).
