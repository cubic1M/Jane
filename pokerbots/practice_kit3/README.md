# Practice Kit 3: "Pitch Hold'em" bot sit-and-go

This kit is a practice run for a timed bot-building tournament in the style of "No
Limit: A Bot Building Tournament". You get **60 minutes** to write a Python bot
that implements the `Agent` interface below. Bots then play 8-bot sit-and-gos
and score points by finishing place.

The game is **no-limit hold'em with one change: you are dealt three hole cards
and discard one face up before the flop** (see [The variant](#the-variant-three-cards-pitch-one)).
Everything else is ordinary no-limit hold'em, but the interface conventions are
probably not the ones you are used to, so read the whole page before you write
any code.

Requirements: Python 3.13, standard library only (no numpy, inside the kit or in
your bot).

---

## Quick start

All commands are run from this directory (`practice_kit3/`).

```bash
python3 run_local.py --bot bots/template_bot.py --tables 20   # play 20 practice tables
python3 check_submission.py bots/template_bot.py               # check the submission rules
python3 icm_calculator.py --schedule                           # blind schedule + points table
python3 icm_calculator.py 8000 5000 2000 1000                  # ICM points for these stacks
python3 -m unittest discover -s tests                          # the engine's own tests
```

Copy `bots/template_bot.py` to start your own bot. Hand logs from the runner are
written to `logs/table_XXX.log`.

## What is in the kit

| Path | What it is |
|---|---|
| `bots/template_bot.py` | Agent template: every callback, card helpers, a simple strategy |
| `bots/calling_station.py`, `bots/tight_aggressive.py`, `bots/random_raiser.py` | Sample opponents |
| `run_local.py` | Local simulator/runner: average points, errors, timeouts, slowest decision |
| `check_submission.py` | Checks a file against the submission rules, then plays a short smoke table |
| `icm_calculator.py` | ICM calculator; also prints the blind schedule and points table |
| `engine/` | The simulator (`table.py`), action parser, evaluator, side pots, ICM, constants (`rules.py`) |
| `tests/` | unittest suite for the engine |

`engine/rules.py` holds every number quoted on this page. If this page and
`rules.py` ever disagree, `rules.py` is what the simulator does; please tell an
organiser.

---

## Tournament format

* **Tables.** 8 bots per table, random seats, random button for hand 1.
  Everyone starts with **2,000 chips**. There are no antes.
* **Blinds.** Start at 10/20 and rise every **25 hands**, counted by the table's
  own hand counter (hand 1 is the first hand at that table):

  | Level | Hands | SB / BB |
  |---|---|---|
  | 1 | 1-25 | 10 / 20 |
  | 2 | 26-50 | 15 / 30 |
  | 3 | 51-75 | 25 / 50 |
  | 4 | 76-100 | 40 / 80 |
  | 5 | 101-125 | 60 / 120 |
  | 6 | 126-150 | 100 / 200 |
  | 7 | 151-175 | 150 / 300 |
  | 8 | 176-200 | 250 / 500 |

* **End of a table.** A table ends when one bot holds all the chips, or after
  **hand 200** is complete, whichever comes first.
* **Points by finishing place** (per table; they sum to 22):

  | Place | 1st | 2nd | 3rd | 4th | 5th | 6th | 7th | 8th |
  |---|---|---|---|---|---|---|---|---|
  | Points | 12 | 7 | 4 | 2 | 0 | 0 | 0 | **-3** |

  Only the top four score positively, and **8th place loses 3 points**.
* **Busting.** A bot with 0 chips after a hand is out and takes the highest
  place still open. If several bots bust in the same hand, the one that started
  that hand with more chips gets the better place. Bots that started the hand
  with exactly equal stacks share those places: each gets the average of the
  points for the places they occupy (e.g. two bots tied for 7th/8th get -1.5 each).
* **Hand cap.** If more than one bot is left after hand 200, the survivors split
  the points for the places still open (1st to kth for k survivors) by **ICM**
  (Malmuth-Harville) on their final chip counts. For example, if all 8 bots are
  still alive, the -3 for 8th is part of what is split. Points are not rounded.
  `icm_calculator.py` computes exactly what the simulator pays.
* **State.** A new `Agent` object is created for every table and your file is
  re-executed in a fresh module, so nothing (instance attributes or module
  globals) carries over from one table to the next.

## The variant: three cards, pitch one

1. Each player is dealt **three** hole cards.
2. **Preflop betting** happens as normal while you hold three cards.
3. **Discard phase.** If two or more players are still in the hand after preflop
   betting, each of them (including players who are all-in) discards exactly one
   hole card **face up**. Players discard one at a time in **postflop action
   order** (first player still in the hand to the left of the button; heads-up,
   the big blind first). Each player sees the discards made before theirs, and
   every discard is announced to the whole table.
4. Discarded cards are **dead**: they are not on the board and cannot be used by
   anyone.
5. The hand continues as ordinary no-limit hold'em with the two kept hole cards:
   flop, turn and river, each followed by a betting round. At showdown each hand
   is the best five cards out of the two kept hole cards plus the five board
   cards (you may use both, one or none of your hole cards).

If the hand ends preflop (everyone folds to one player), there is no discard
phase. Folded players do not discard.

---

## The Agent interface

Your submission is one Python file that defines a class named exactly `Agent`.
The engine calls `Agent()` with no arguments and then calls the methods below.
Two methods are **decisions** and must return a value; the rest are
**notifications** (return value ignored). Any notification you do not define is
simply not called.

| Method | When | Must return |
|---|---|---|
| `on_table_start(info)` | once, before hand 1 | - |
| `on_hand_start(hand)` | start of every hand (you are always dealt in while alive) | - |
| `on_event(event)` | every public action: blinds, folds, checks, calls, bets, raises, discards, new board cards, including your own actions | - |
| `on_discard_request(state)` | your turn to discard | the **card integer** to discard |
| `on_action_request(state)` | your turn to bet | an action **string** |
| `on_showdown(result)` | after a hand that reached showdown | - |
| `on_hand_end(result)` | end of every hand, also the hand in which you bust | - |

After you bust you receive no more callbacks.

### Units: chips in, big blinds out

* **Every amount the engine sends you is in chips.**
* **The raise amount you send back is in big blinds** (see below).

The size of a big blind in chips is given in every request as `bb` and changes
with the blind level.

### Action strings (return value of `on_action_request`)

| String | Meaning |
|---|---|
| `"f"` | fold |
| `"c"` | call; if nothing is owed it is a check; if you cannot cover the bet it is an all-in call for less |
| `"r <x>"` | raise **to** `x` big blinds |

Details of `"r <x>"`:

* `x` is the **total** you want to have put in **on this street** after the
  raise, including any chips you already put in on this street (blinds count:
  a small blind that sends `"r 3"` at 10/20 ends with 60 chips in, adding 50).
  It is *not* the amount added and *not* the amount above the current bet.
* `x` is measured in **big blinds of the current level**. At 10/20, `"r 3"` is
  a raise to 60 chips; at 250/500, `"r 3"` is a raise to 1,500 chips.
* `x` is rounded to the nearest **0.5 bb**, halves rounded up: `2.25 -> 2.5`,
  `2.24 -> 2.0`, `2.75 -> 3.0`. The raise in chips is then `rounded_x * bb`.
* If the rounded amount is below the minimum legal raise, you raise the minimum
  (`min_raise_to`). If it is at or above everything you have, you go all-in.
  So `"r 999"` is a convenient all-in.
* If you are not allowed to raise (`can_raise` is false), `"r <x>"` is played
  as `"c"`.
* A "bet" (first chips into a postflop street) uses the same `"r <x>"` string;
  the engine reports it as a `bet` event.
* Syntax: case-insensitive, surrounding whitespace ignored, one or more spaces
  between `r` and the number. The number is a plain decimal such as `3`, `2.5`,
  `.5` or `2.`; no sign, exponent, comma or unit (`"r 2.5bb"` is invalid).
* **Anything else is invalid** (for example `"k"`, `"x"`, `"check"`,
  `"call"`, `"raise 3"`, `"r3"`, a number, `None`). An invalid action counts as an
  error and is replaced by the default action: **check if checking is free,
  otherwise fold**.
* `"f"` is always a fold, even when you could have checked for free.

### Discard return value (return value of `on_discard_request`)

Return **one of the integers in `state["hole_cards"]`** (the card itself, not its
position in the list). Anything else (an int you do not hold, a string, `None`,
a bool) is an error, and the engine discards `hole_cards[0]` for you. Hole cards
are listed in the order they were dealt, not sorted.

### Payloads

All payloads are plain dicts/lists built fresh for you; changing them does not
affect the game. Player ids are strings.

`on_table_start(info)`:

| Key | Meaning |
|---|---|
| `table_id` | e.g. `"T007"` |
| `your_id` | your player id at this table |
| `seating` | all player ids in clockwise seat order (yours included) |
| `starting_stack` | 2000 |
| `blind_levels` | `[[10, 20], [15, 30], ...]` |
| `hands_per_level`, `max_hands` | 25, 200 |
| `points` | `[12, 7, 4, 2, 0, 0, 0, -3]` |
| `time_limit_ms` | 1.0 |

`on_hand_start(hand)`: `hand_number`, `level`, `sb`, `bb`, `button` (player id),
`your_position`, `positions` (`{id: position name}` for everyone dealt in),
`stacks` (`{id: chips}` before blinds), `hole_cards` (your three cards),
`hands_left` (hands remaining after this one before the cap).

`on_action_request(state)`:

| Key | Meaning (chips unless stated) |
|---|---|
| `hand_number`, `street` | street is `"preflop"`, `"flop"`, `"turn"` or `"river"` |
| `position` | your position name |
| `hole_cards` | 3 cards preflop, your 2 kept cards afterwards |
| `board` | board cards so far |
| `discards` | `{id: card}` face-up discards so far (empty preflop) |
| `pot` | all chips put in this hand by everyone, including this street's bets |
| `current_bet` | highest street total on this street (preflop starts at the big blind) |
| `your_bet` | what you have put in on this street |
| `to_call` | chips needed to call (already capped at your stack) |
| `stack` | your chips behind, **not** counting `your_bet` |
| `can_raise` | whether a raise is allowed |
| `min_raise_to`, `max_raise_to` | street totals in **chips**; `None` when `can_raise` is false |
| `sb`, `bb`, `level` | current blinds |
| `players` | list of `{id, position, stack, bet, contributed, status, discard}` for everyone dealt in, button first then clockwise; `status` is `"active"`, `"folded"` or `"allin"` |
| `history` | list of this hand's events so far (same dicts as `on_event`) |
| `hands_left` | hands remaining after this one before the cap |

`on_discard_request(state)`: `hand_number`, `street` (`"discard"`),
`position`, `hole_cards` (your three cards), `discards` (`{id: card}` made so far
this hand), `discard_order` (ids in the order they discard), `pot`, `stack`,
`sb`, `bb`, `level`, `players`, `history`.

`on_event(event)`: always has `type` and `street`; actions also have `player`.

| `type` | Extra keys |
|---|---|
| `blind` | `blind` (`"SB"`/`"BB"`), `amount`, `allin` |
| `fold`, `check` | `auto` |
| `call` | `amount` (chips added), `to` (street total), `allin`, `auto` |
| `bet`, `raise` | `amount` (chips added), `to` (street total), `allin`, `auto` |
| `discard` | `card`, `auto` (street is `"discard"`) |
| `street` | `cards` (new cards), `board` (whole board) |

`auto` is true when the action was chosen by the engine because the bot timed
out, crashed or returned something invalid. That is public information.

`on_showdown(result)`: `hand_number`, `board`, `hands` (`{id: [2 cards]}` for
every player at showdown; nobody mucks), `hand_names`, `pots` (list of
`{amount, eligible, winners, hand}`, main pot first).

`on_hand_end(result)`: `hand_number`, `stacks`, `net` (chip change this hand),
`busted` (ids), `showdown` (bool), `pots`, `discards`.

---

## Cards

Cards are integers 0..51:

```
card = suit * 13 + rank
rank = card % 13   0='2' 1='3' 2='4' 3='5' 4='6' 5='7' 6='8' 7='9' 8='T' 9='J' 10='Q' 11='K' 12='A'
suit = card // 13  0='s' (spades)  1='h' (hearts)  2='d' (diamonds)  3='c' (clubs)
```

Examples: `0` = 2s, `12` = As, `13` = 2h, `25` = Ah, `38` = Ad, `51` = Ac.

## Positions and player ids

Positions are names, not seat numbers. Listed from the button clockwise:

| Players dealt in | Positions |
|---|---|
| 8 | BTN SB BB UTG UTG1 MP HJ CO |
| 7 | BTN SB BB UTG MP HJ CO |
| 6 | BTN SB BB UTG HJ CO |
| 5 | BTN SB BB HJ CO |
| 4 | BTN SB BB CO |
| 3 | BTN SB BB |
| 2 | BTN BB |

* Heads-up, the **BTN posts the small blind** (there is no `"SB"` name), acts
  first preflop and last on later streets.
* With 3+ players, preflop action starts with the player after the BB; later
  streets start with the first player still in the hand after the button.
* **Button and blinds:** each hand the button moves to the next seat clockwise
  that still has a live bot, and the blinds are the next one or two live bots.
  There are no dead-button or dead-blind rules, so after a bust a bot can pay
  the big blind twice in a row or skip a blind.
* A blind larger than your stack is posted all-in for less. Preflop the bet to
  call is still the full big blind.
* **Player ids** are random strings like `"pk3x"`, fixed for the whole table but
  freshly drawn at every table. You are told your own id; you are never told
  which program an id belongs to.

## Betting rules

* No-limit. The minimum opening bet on any street is 1 big blind. The minimum
  raise is to the current bet plus the size of the last full bet or raise on
  that street (preflop the big blind counts as the opening bet).
* An all-in raise smaller than a full raise does **not** reopen the betting:
  players who already acted on this street and face only that short raise may
  call or fold, not raise (`can_raise` is false). Two short all-ins in a row
  never add up to reopen it.
* You cannot raise when every other player still in the hand is all-in.
* Side pots are formed as usual. An uncalled bet is returned. When a pot is
  split, odd chips go one at a time to the winners in order clockwise from the
  left of the button.

---

## Timing

* The limit is **1 ms per decision** (`on_action_request`, `on_discard_request`),
  measured as wall-clock time (`time.perf_counter_ns`) around your call. The
  engine builds the payload before starting the clock.
* **Time spent in your notification callbacks counts too:** it is added up and
  charged to your **next decision** (including across hands). A decision is a
  timeout when *(notification time since your previous decision) + (time in this
  decision)* exceeds 1 ms. The total resets after every decision.
* Your function is not interrupted: on a timeout the engine waits for it to
  return, throws the result away and plays the default (check if free,
  otherwise fold; for a discard, `hole_cards[0]`).
* **Setup budget:** executing your file, `Agent()` and `on_table_start` together
  must take at most **250 ms** per table. If they take longer, or `Agent()`
  raises, your bot is not called again at that table and auto-plays every
  decision with the default (it still posts blinds and can still finish in any
  place). Going over budget counts as one timeout; `Agent()` raising counts as
  one error. An exception inside `on_table_start` is only counted as an error:
  the bot keeps playing.
* Garbage collection, printing and anything else that happens during your call
  count against you.

## Errors

| Situation | Result |
|---|---|
| Exception in a decision | default action (check if free, else fold / discard `hole_cards[0]`); 1 error |
| Exception in a notification | ignored; 1 error |
| Invalid action string or discard | default action; 1 error |
| Timeout | default action; 1 timeout |
| Missing `on_action_request` / `on_discard_request` | default action every time; 1 error each time |

There is no disqualification for errors; the default actions are their own
punishment.

## Submission rules

* **One file**, ending in `.py`, defining a top-level class named exactly
  `Agent` with methods `on_action_request` and `on_discard_request`; `Agent()`
  must work with no arguments.
* **Size:** at most **32,000 bytes** (bytes of the UTF-8 file, comments and
  docstrings included; this is not 32 KiB).
* **Allowed imports** (top-level package name): `math`, `random`, `itertools`,
  `functools`, `collections`, `heapq`, `bisect`, `time`, `typing`,
  `dataclasses`, `enum`, `operator`, `__future__`. Nothing else, so no `numpy`,
  `re`, `os`, `sys`, and no kit modules (`engine`, `icm_calculator`). No relative
  imports.
* **Not allowed anywhere in the file**, as a name or as an attribute name (so
  `self.open` is rejected too): `eval`, `exec`, `compile`, `open`,
  `__import__`, `input`, `breakpoint`, `exit`, `quit`, `globals`,
  `__builtins__`; also any attribute starting with `__subclasses`.
* `check_submission.py` checks all of this statically, then plays a 60-hand
  smoke table with the real time limits and reports errors and timeouts as
  warnings. A file that fails the checker will not be entered.

## Tools

### `run_local.py`

```
python3 run_local.py --bot BOT.py [--tables 20] [--opponents A.py B.py ...] [--seats 8]
                     [--seed N] [--max-hands 200] [--time-limit-ms 1.0] [--time-scale 1.0]
                     [--no-timeouts] [--log-dir logs] [--no-logs] [--quiet]
```

Your bot takes one seat at each table; the other seats are filled by cycling
through `--opponents` (default: the three sample bots). It prints one line per
table, a table of all bots (average points, standard deviation, finishing
places, number of ICM survivals, errors, timeouts, slowest decision), and a
summary for your bot with the first few error/timeout messages. The "slowest
decision" is the charged time (notifications included); the slowest call on its
own is printed beside it. `--time-scale 2` doubles every limit for a slow
laptop; `--no-timeouts` measures but never enforces. Tables with fewer than 8
seats are for debugging only; points are still taken from the 8-place table.

### Hand logs

`logs/table_XXX.log`, one file per table: seats, every hole card (organiser's
view), blinds, actions with the string each bot sent, discards, board, showdown,
pots, busts and the final ICM split.

### `icm_calculator.py`

`python3 icm_calculator.py 8000 5000 2000 1000` prints the ICM points those
stacks would receive at the hand cap (default payouts: the official points for
places 1..k). `--payouts` overrides them; `--schedule` prints blinds and points.

---

## Known open questions

These are things the organisers have not pinned down (or that differ between
this kit and the event). Plan for them rather than assuming.

1. **Hardware.** The tournament machine is not your laptop and may be slower or
   noisier. There is no allowance for garbage-collection pauses or a busy
   machine. Leave yourself a large margin under 1 ms.
2. **Number of tables and aggregation.** How many tables each bot plays in the
   real event, and whether points are summed or averaged, is not announced. The
   runner prints averages.
3. **Opponent mix.** The real field is other teams' bots; whether a table can
   contain two copies of the same program is not specified. The local runner
   never seats two copies of your bot.
4. **Shared standard library modules.** Locally, all bots run in one process,
   so the global `random` generator (and any other module state) is shared
   between bots at a table. Whether the tournament isolates bots further is not
   specified. Use your own `random.Random()` instance.
5. **Printing.** Printing is allowed locally (it appears in your terminal and
   its time counts). Whether stdout is kept or discarded in the tournament is
   not specified.
6. **Memory.** No memory limit is stated.
7. **Rounding of ICM points.** The kit keeps fractional points. The event may
   round them for display; it is not known whether rounding affects rankings.
8. **Ties in final standings.** How teams with equal total points are ranked is
   not specified.
