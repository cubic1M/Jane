# No Limit — Rehearsal Starter Kit

Welcome. You have **60 minutes** to build a Python bot that plays this event's
poker variant in 8-bot sit-and-go tables. This kit has everything you need:

```
README.md                 this file (rules, interface, schedule, points)
kit/
  table_api.py            the Agent interface: Agent, Action, Observation, ...
  agent_template.py       a working (but bad) bot to start from
  engine.py               the table simulator (same rules as the tournament)
  run_local.py            play N tables of your bot against the sample bots
  icm.py                  ICM calculator (also used to score the 200-hand cap)
  cards.py                card parsing and a hand evaluator for this variant
  config.py               blind schedule, points table, limits
  sample_bots/            random_bot.py, tight_bot.py, pusher_bot.py
  tests/                  tests for the engine (python3 -m unittest)
```

Requirements: Python 3.13 and numpy. Nothing else is installed on the
tournament machines.

---

## 1. Format

- Each table seats **8 bots**. Every bot starts with **2,000 chips**.
- Blinds start at **10/20** and go up every **25 hands** (schedule below).
- A table ends when one bot has all the chips, or after **hand 200**,
  whichever comes first.
- Points are awarded by finishing place (table below). If more than one bot is
  still alive after hand 200, the points for the places that are still open
  are split between the survivors **by ICM** on their final stacks.
- Your final score is your total points over all the tables you play. Seats
  and opponents are drawn at random for every table.
- **Bot state resets every table**: a fresh instance of your `Bot` class is
  created for each table, and each table runs in its own process.

## 2. The variant: Six-Plus Hold'em

This event's variant is **Six-Plus Hold'em** (also called short deck). It is
no-limit Texas Hold'em with these changes:

1. **36-card deck.** All 2s, 3s, 4s and 5s are removed. The deck is
   6 7 8 9 T J Q K A in four suits.
2. **Hand ranking is changed.** From strongest to weakest:

   | Rank | Hand | Note |
   |---:|---|---|
   | 1 | Straight flush | `T J Q K A` suited is the best hand |
   | 2 | Four of a kind | |
   | 3 | **Flush** | beats a full house in this variant |
   | 4 | **Full house** | |
   | 5 | **Three of a kind** | beats a straight in this variant |
   | 6 | **Straight** | |
   | 7 | Two pair | |
   | 8 | One pair | |
   | 9 | High card | |

3. **The ace plays low in one straight:** `A 6 7 8 9` is a straight (the
   lowest one, nine-high). There is no other "wraparound" straight.
4. **Antes** are added from level 3 (see the schedule).

Everything else is standard no-limit hold'em: two private hole cards each,
five community cards (flop 3, turn 1, river 1), and each player's hand is the
best five cards out of their two hole cards and the board, using any number
of hole cards. Suits never break ties. Equal hands split the pot; an odd chip
goes to the first winner clockwise from the button.

`kit/cards.py` has `evaluate(cards)` which scores 5 to 7 cards with these
rules (larger tuple = better hand).

## 3. Blind schedule

| Level | Hands | Small blind | Big blind | Ante (every player) |
|---:|---|---:|---:|---:|
| 1 | 1 – 25 | 10 | 20 | – |
| 2 | 26 – 50 | 15 | 30 | – |
| 3 | 51 – 75 | 25 | 50 | 5 |
| 4 | 76 – 100 | 40 | 80 | 10 |
| 5 | 101 – 125 | 50 | 100 | 10 |
| 6 | 126 – 150 | 75 | 150 | 15 |
| 7 | 151 – 175 | 100 | 200 | 25 |
| 8 | 176 – 200 | 150 | 300 | 25 |

Hands are counted per table, starting at 1. The level does not depend on how
many bots are left.

**Antes** are posted by every player dealt into the hand, before the blinds.
Antes are dead money: they go straight into the pot and do not count towards
the bet you need to call. A player who cannot cover the ante posts what they
have and is all-in.

## 4. Points for this variant

The point table may differ between variants. For Six-Plus Hold'em it is:

| Finish | Points |
|---|---:|
| 8th (first bot out) | 0 |
| 7th | 5 |
| 6th | 15 |
| 5th | 25 |
| 4th | 35 |
| 3rd | 50 |
| 2nd | 70 |
| 1st | 100 |

`kit/config.py` has the same values as `POINTS_BY_FINISH`, listed in the
same order as this table (8th place first), and `points_for_place(place)`.

- **Several bots out in the same hand:** the one who started that hand with
  more chips gets the better place. Bots who started the hand with exactly the
  same stack share the points of their places equally.
- **Hand cap:** if k > 1 bots are alive after hand 200, they share the points
  for places 1st to kth according to ICM (Malmuth-Harville) on their stacks;
  see `kit/icm.py`. Example: three survivors with 9,000 / 4,500 / 2,500 chips
  share 100 + 70 + 50 = 220 points as `icm_equity([9000, 4500, 2500], [100, 70, 50])`.

## 5. Betting rules

- No limit. "Raise" is used both for the first bet on a street and for a raise.
- The minimum opening bet is the big blind. The minimum raise is the size of
  the last full bet or raise on that street (preflop, the big blind counts as
  the opening bet).
- An all-in that is less than a full raise **does not reopen the betting** to
  players who have already acted on that street: they may only call or fold
  (unless someone else makes a full raise afterwards).
- If a blind is short (the player had fewer chips than the blind), the other
  players still have to call the full big blind.
- Bets that nobody calls are returned to the bettor at the end of the round.
- **Heads-up** (two bots left): the button posts the small blind and acts
  first before the flop, and last after the flop.
- If all but one of the players still in the hand are all-in, the remaining
  cards are dealt with no further betting.

## 6. Seats, button and positions

- Seats are numbered **0 to 7** and never change during a table. Your seat is
  drawn at random for each table.
- The button starts on a random seat for hand 1 and then moves clockwise
  (to the next higher seat number, wrapping from 7 to 0) to the next seat that
  still has chips. Eliminated seats are skipped.
- With 3 or more players the small blind is the next live seat after the
  button and the big blind the next live seat after that. Preflop action starts
  with the next seat after the big blind; on later streets with the first live
  seat after the button.
- Eliminated bots keep their seat in the observation (see `status`).

## 7. Cards

Cards are two-character strings: rank then suit.

- Ranks: `6 7 8 9 T J Q K A` (ten is `T`)
- Suits: `c d h s` (lower case)

Examples: `"As"`, `"Td"`, `"6c"`.

## 8. The Agent interface

Your bot is a class named **`Bot`** that subclasses `table_api.Agent`:

```python
from table_api import Agent, Action, Observation, HandSummary, CHECK, RAISE

class Bot(Agent):
    def __init__(self):
        ...                                  # once per table, not timed per decision

    def decide(self, obs: Observation) -> Action:
        if CHECK in obs.legal_actions:
            return Action.check()
        return Action.call()

    def hand_over(self, summary: HandSummary) -> None:   # optional
        ...
```

`decide()` is called every time it is your turn. It must return an `Action`.

### Action

| You want to | Return |
|---|---|
| fold | `Action.fold()` |
| check | `Action.check()` |
| call | `Action.call()` |
| bet or raise | `Action.raise_(amount)` |

`Action(kind, amount)` is a frozen dataclass; `Action("raise", 120)` works too.

**How raises are expressed:** `amount` is the **total** number of chips you
will have in front of you for the **current betting round** after the raise
(a "raise to" amount). It does not include antes or chips from earlier
streets. Example: preflop at 10/20, a player raises to 60 and you want to
make it 180 total: return `Action.raise_(180)`. To go all-in return
`Action.raise_(obs.max_raise_to)`.

Every legal raise amount is between `obs.min_raise_to` and `obs.max_raise_to`
(both inclusive).

What happens with actions that do not fit the situation:

| You return | Result |
|---|---|
| `raise` with an amount below `min_raise_to` | raise to `min_raise_to` |
| `raise` with an amount above `max_raise_to` | all-in (`max_raise_to`) |
| `raise` with a non-integer number | truncated to an integer, then as above |
| `raise` when `"raise"` is not in `legal_actions` | call (check if `to_call` is 0) |
| `check` when `to_call > 0` | fold |
| `call` when `to_call` is 0 | check |
| `fold` when you could check | fold |
| anything that is not an `Action`, an unknown kind, or a raise amount that is not a number | error: fold (check if free) |

### Observation

| Field | Meaning |
|---|---|
| `hand_number` | 1-based hand number at this table |
| `level`, `small_blind`, `big_blind`, `ante` | current blind level and amounts |
| `seat` | your seat (0–7) |
| `button`, `small_blind_seat`, `big_blind_seat` | seats for this hand |
| `street` | `"preflop"`, `"flop"`, `"turn"` or `"river"` |
| `hole` | your two cards, e.g. `("As", "Td")` |
| `board` | community cards so far (0, 3, 4 or 5) |
| `players` | tuple of `PlayerInfo`, **one per seat, indexed by seat number** (always 8 entries) |
| `pot` | chips in the middle from **previous** betting rounds plus all antes; the current round's bets are in `players[i].committed` |
| `to_call` | chips you must add to call (current highest bet minus your `committed`); may be more than your stack, in which case calling puts you all-in |
| `min_raise_to`, `max_raise_to` | legal raise-to range for you; both `0` when you cannot raise. `max_raise_to` is your stack plus your `committed` (all-in) |
| `legal_actions` | frozenset of kinds you may use, e.g. `{"fold", "call", "raise"}` |
| `history` | tuple of `Event`s for this hand so far, in order |
| `max_hands` | the hand cap (200) |
| `time_limit_ms` | 1.0 |
| `me` | property, same as `players[seat]` |

`PlayerInfo` fields:

| Field | Meaning |
|---|---|
| `seat` | seat number |
| `stack` | chips behind, **not** counting `committed` |
| `committed` | chips this player has put in during the current betting round (blinds count on preflop, antes do not) |
| `status` | `"active"` (can act), `"folded"`, `"allin"`, or `"out"` (eliminated earlier; `stack` 0, not dealt in) |

`Event(street, seat, kind, amount)` in `history`:

| `kind` | `amount` |
|---|---|
| `"ante"`, `"sb"`, `"bb"` | chips posted |
| `"fold"`, `"check"` | 0 |
| `"call"` | chips added by the call |
| `"raise"` | the raise-to total for that street (same meaning as `Action.amount`) |

Auto-folds and auto-checks (timeouts, errors) appear as ordinary `fold` and
`check` events.

### HandSummary (argument of `hand_over`)

| Field | Meaning |
|---|---|
| `hand_number` | |
| `board` | final board (all five cards when the hand reached showdown) |
| `shown` | dict seat → hole cards for every hand at showdown (empty if everyone folded) |
| `won` | tuple, chips each seat collected from the pot (gross, indexed by seat) |
| `stacks` | stacks after the hand, indexed by seat |
| `busted` | seats eliminated in this hand |
| `history` | every `Event` of the hand |

## 9. Time limit and errors

- **Each call to `decide()` must return within 1 millisecond.** The engine
  reads `time.perf_counter()` immediately before calling `decide(obs)` and
  immediately after it returns. If more than 1.000 ms passed, your action is
  thrown away and you **fold, or check if checking is free**. The Observation
  is built before the clock starts. Everything that happens during your call
  counts: first-time setup, imports, garbage collection, printing.
- If `decide()` raises an exception or returns something that is not a valid
  `Action`, you fold (check if free). The table carries on; there is no other
  penalty, and you are asked again on your next turn.
- `hand_over()` has the same 1 ms limit. Overrunning it or raising in it has
  no effect on the game; it only shows up in the local stats.
- `Bot()` (your `__init__`) is called once per table and may take up to
  1 second. If it fails or takes longer, your bot folds/checks every decision
  for that whole table.
- Tournament machines are comparable to a recent laptop, but they run many
  tables at once. Check the "slowest decision" line of `run_local.py` and keep
  a margin; you can test with a stricter limit using `--time-limit-ms 0.5`.

## 10. The local simulator

From the kit root (the folder that holds this README):

```bash
python3 kit/run_local.py --bot kit/agent_template.py --tables 20
python3 kit/run_local.py --bot submission/bot.py --tables 200 --seed 42
```

Options:

| Option | Default | |
|---|---|---|
| `--bot PATH` | required | your bot file (must define `class Bot`) |
| `--tables N` | 20 | number of tables to play |
| `--opponents LIST` | `tight,random,pusher` | comma-separated: `caller` (the template), `random`, `tight`, `pusher`, or paths to other bot files. The 7 opponent seats are filled in rotation from this list |
| `--seed N` | random | seed for seats, button and cards (printed in the output) |
| `--log PATH` | `logs/hands.log` | where to write the hand log |
| `--no-log` | | do not write a hand log |
| `--time-limit-ms X` | 1.0 | per-decision limit |

It prints your average points and place, a histogram of places, the number of
decisions, errors and timeouts, the slowest and mean decision time, the
average points of each opponent type, and the first error traceback from your
bot if there was one.

`run_local.py` loads your file once and plays all tables in one process
(a fresh `Bot()` for each table). In the tournament every table is a separate
process, so module-level variables do not carry over from one table to the
next there.

### Hand log

The log is tab-separated text with one line per event. The first line is a
header starting with `#`. Empty fields are `-`. (Tabs are shown as spaces
below.)

```
#table  hand  level  street  seat  name  event  amount  stack  pot  info
1       1     1      preflop -     -     HAND   -       -      0    button=4 sb=5 bb=6 blinds=10/20 ante=0
1       1     1      preflop 5     tight5 SB    10      1990   10   -
1       1     1      preflop 2     you   CALL   20      1980   50   -
```

| Column | Meaning |
|---|---|
| `table`, `hand`, `level` | numbers as in the Observation |
| `street` | `preflop`, `flop`, `turn`, `river`, `showdown` or `end` |
| `seat`, `name` | the player (`-` for board lines); your bot is `you` |
| `event` | see below |
| `amount` | depends on the event, see below |
| `stack` | the player's chips behind after the event |
| `pot` | all chips in the middle after the event, **including** the current round's bets (on `WIN` lines: the whole pot being paid out) |
| `info` | extra text: cards, `allin`, notes such as `illegal check -> fold` |

Events: `HAND` (start of hand), `ANTE`, `SB`, `BB` (amount posted), `HOLE`
(hole cards, info), `FOLD`, `CHECK`, `CALL` (amount = chips added),
`RAISE` (amount = raise-to total for the street), `TIMEOUT` / `ERROR` (just
before the automatic action; info = time or error), `RETURN` (uncalled chips
given back), `FLOP` / `TURN` / `RIVER` (info = board so far), `SHOW` (info =
cards and hand name), `WIN` (amount won; info `pot=0` is the main pot,
`pot=1` the first side pot, ...), `BUST` (info = place), `FINISH` (one line per
seat at the end of the table; amount = points, info = place).

The local log shows every player's hole cards. In the tournament you only see
what the Observation and HandSummary give you.

## 11. ICM calculator

```bash
python3 kit/icm.py 9000 4500 2500 --payouts 100 70 50
```

or from Python: `from icm import icm_equity, finish_probabilities`.

## 12. Submitting

- Your submission is **one file: `submission/bot.py`**, defining `class Bot`
  (a subclass of `table_api.Agent`, constructed with no arguments).
- Start by copying the template: `mkdir -p submission && cp kit/agent_template.py submission/bot.py`.
- You may import the Python standard library, numpy, and the kit modules
  `table_api`, `cards`, `config` and `icm` (they are importable as top-level
  modules in the tournament, as they are when you use `run_local.py`).
  Do not import other files of your own: only `bot.py` is uploaded.
- No network access, no writing files, no threads or subprocesses. Anything
  you print is discarded.
- Whatever is in `submission/bot.py` when the 60 minutes end is your entry.
  Before the deadline, make sure this works:

  ```bash
  python3 kit/run_local.py --bot submission/bot.py --tables 5
  ```

## 13. Running the kit's tests

```bash
python3 -m unittest discover -s kit/tests
```

## 14. FAQ

**Can I see my opponents' cards?** Only those shown at showdown, through
`hand_over()` (`summary.shown`).

**Do I know which bot is in which seat?** No. Opponents are anonymous and
change every table.

**Is the 1 ms limit per hand or per decision?** Per decision.

**What happens to my chips if I time out?** Nothing special: you fold (or
check) on that decision and play on.
