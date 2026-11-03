# Practice Kit 4: Six-Plus sit-and-go (dress rehearsal)

This is the organisers' kit for the rehearsal event. You submit **one Python
file**. It plays 8-bot no-limit sit-and-go tables. **Today's secret variant is
Six-Plus Hold'em** (section 2): a 36-card deck and a changed hand ranking.

The bot interface in this kit is **new**. It is not the interface of earlier
kits: function names, the observation, the reply, seat numbers and the clock
all differ. Read section 4 carefully.

Python 3.13. Bots may use numpy; nothing in the kit needs it.

```
practice_kit4/
  README.md              the rules (this file)
  check_submission.py    the same checks the organisers run on your file
  run_local.py           plays N tables of your bot against the sample bots
  bots/template_bot.py   start here
  bots/*.py              six sample opponents (section 9)
  engine/                the reference engine (not importable by your bot)
    rules.py             every number in this README
    cards.py             deck and Six-Plus evaluator
    actions.py           how your reply becomes an action
    table.py             the table;  seats.py: loading and the clock;  icm.py
  tests/                 python3 -m unittest
```

## Quick start

```
cd practice_kit4
cp bots/template_bot.py my_bot.py
python3 check_submission.py my_bot.py
python3 run_local.py --bot my_bot.py --tables 50 --seed 7
python3 run_local.py --bot my_bot.py --tables 3 --log-dir logs      # hand histories
python3 -m unittest                                                  # engine tests
```

## 1. Event format

| | |
|---|---|
| Table | 8 bots, sit-and-go, seats drawn at random |
| Starting stack | 2,000 chips, no antes |
| Blinds | 10/20, rising every 25 hands (schedule below) |
| Hand cap | the table stops after hand 200; survivors are paid by ICM |
| Clock | 1 ms per decision; an over-time decision is folded (section 5) |
| Score | your average points per table, over all tables you play |

| Level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| Hands | 1-25 | 26-50 | 51-75 | 76-100 | 101-125 | 126-150 | 151-175 | 176-200 |
| SB / BB | 10/20 | 20/40 | 30/60 | 50/100 | 75/150 | 100/200 | 150/300 | 200/400 |

**Points per table** (275 in total):

| Place | 1st | 2nd | 3rd | 4th | 5th | 6th | 7th | 8th |
|---|---|---|---|---|---|---|---|---|
| Points | 100 | 65 | 45 | 30 | 20 | 10 | 5 | 0 |

* A bot with 0 chips after a hand is out and takes the worst place still open.
  If several bots go out in the same hand, the one that **started the hand with
  more chips** places higher. Bots that started it with exactly equal stacks
  share the points of the places they take (two bots out together in 6th/7th
  get (10+5)/2 = 7.5 each).
* A table ends when one bot has every chip, or when hand 200 is complete.
* **At the cap**, the k survivors split the points for places 1..k by
  **ICM (Malmuth-Harville)** on their final stacks. Points are not rounded.
  The chip leader does not get 100. `engine/icm.py` is the exact formula.

## 2. The variant: Six-Plus Hold'em (revealed on the day)

Everything is no-limit Texas hold'em (two hole cards, flop, turn, river, best
five of seven) **except**:

1. **The deck has 36 cards.** All 2s, 3s, 4s and 5s are removed. Ranks are
   `6 7 8 9 T J Q K A`; suits `c d h s`.
2. **A flush beats a full house.**
3. **Three of a kind beats a straight.**
4. **A-6-7-8-9 is a straight** (the lowest one; it plays as 9-high). A-2-3-4-5
   cannot exist. The ace is still high in every other hand.

Hand ranking, best first:

| | Category | Example |
|---|---|---|
| 1 | Straight flush | `Th Jh Qh Kh Ah` ... `Ah 6h 7h 8h 9h` |
| 2 | Four of a kind | `7c 7d 7h 7s` |
| 3 | **Flush** | `Ah Jh 9h 7h 6h` |
| 4 | **Full house** | `Kc Kd Ks 7h 7d` |
| 5 | **Three of a kind** | `8c 8d 8h` |
| 6 | **Straight** | `Tc Jd Qh Ks Ad` ... `Ac 6d 7h 8s 9d` |
| 7 | Two pair | |
| 8 | Pair | |
| 9 | High card | |

Ties within a category are broken exactly as in hold'em (kickers; suits never
matter). `engine/cards.py` is the reference evaluator.

## 3. Seats, button and order of play

* Seats are numbered **1 to 8** and **never change during a table**. A bot that
  is out keeps its seat number (status `"out"`). Clockwise = increasing seat
  number, wrapping from 8 to 1.
* Hand 1: the button is a random seat. After that it moves to the next seat
  clockwise that still has chips. The next two live seats after the button post
  the small and big blind (there is no dead button or dead blind).
* **Heads-up:** the button posts the small blind and acts first before the
  flop; the other bot acts first after the flop.
* 3+ bots: the bot after the big blind acts first before the flop; after the
  flop, the first live bot clockwise from the button.
* Cards are dealt one at a time clockwise starting left of the button.

## 4. The bot interface

Your file must define:

```python
NAME = "Team Name Bot"            # str, 1-24 printable characters
def play(view, memory) -> int:    # every betting decision
def setup(rules) -> None:         # optional, once after import
```

### 4.1 `setup(rules)`

Called once, right after your file is imported. `rules` is a dict:
`variant` (`"six-plus"`), `deck` (the 36 card strings), `hand_ranking`
(category names, **worst first**), `seats` (8), `starting_stack`, `blinds`
(`[[10, 20], [20, 40], ...]`), `hands_per_level`, `max_hands`, `points`,
`ms` (1.0) and `bench_after` (3).

### 4.2 `view` (what you see on each decision)

A fresh dict of plain Python values (JSON-compatible). Amounts are **chips**.

| Key | Meaning |
|---|---|
| `hand` | hand number at this table, 1-based |
| `hands_left` | hands that will still be dealt after this one (0 on hand 200) |
| `level`, `sb`, `bb` | blind level 1-8 and its blinds |
| `blinds_up_in` | hands left at this level including this one; `None` at level 8 |
| `street` | **integer**: 0 preflop, 1 flop, 2 turn, 3 river |
| `me` | your seat number (1-8) |
| `button`, `sb_seat`, `bb_seat` | seat numbers |
| `hole` | your two cards, e.g. `["Ah", "Td"]` (rank char + lowercase suit, `T` = ten) |
| `board` | 0, 3, 4 or 5 cards |
| `pot` | every chip put in this hand so far, all streets, including current bets |
| `owe` | chips you must add to call (0 = you may check) |
| `min_add` | the fewest chips you can add to make a legal raise; **`None` if you may not raise** |
| `max_add` | your stack: adding this much puts you all-in |
| `seats` | list of 8 dicts, **`view["seats"][k - 1]` is seat `k`** (below) |
| `log` | this hand's actions so far (section 4.4) |
| `last_hand` | public result of the previous hand at this table, or `None` (4.5) |
| `ms` | the time limit in ms (1.0) |

Each `seats` entry: `seat`, `stack` (chips behind), `bet` (put in on this
street), `total` (put in this hand), `status`: `"in"`, `"allin"`, `"folded"`
or `"out"` (not dealt in: no chips left).

You may raise only when (a) at least one other bot in the hand still has chips,
(b) you have more than `owe`, and (c) the betting is open to you (section 8).

### 4.3 Your reply: chips to add now

Return **one integer: the number of chips you push into the pot now.**

| You return | Result |
|---|---|
| any negative number, e.g. `-1` | fold |
| `0` when `owe == 0` | check |
| less than `owe` (including `0`!) | **fold** (unless that amount puts you all-in) |
| `owe` up to `min_add - 1` | call (when `owe == 0`: check) |
| `min_add` or more | raise by adding exactly that many chips |
| `max_add` or more | all-in (a raise if allowed, else a call, or a check if nothing is owed) |
| anything that is not an integer | invalid: 1 error, then check if free, else fold |

* The amount is what you **add**, not a "raise to" total and not the size of
  the raise above the current bet. Facing a bet of 100 after you put in 20,
  `owe` is 80; to raise to 300 you return 280.
* A bet (the first chips on a postflop street) is just a raise from 0.
* If raising is not allowed (`min_add is None`), anything `>= owe` is a call.
* If you cannot cover `owe`, returning `max_add` (or more) calls all-in for less.
* An all-in for less than `min_add` is allowed (see section 8 for its effect).
* Python `int` and numpy integer types are accepted. `bool`, `float` (even
  `20.0`), strings, `None` and lists are invalid.

### 4.4 The `log` string

One token per action, separated by single spaces, in the order they happened:
`<seat><code><chips added>`. Codes: `s` small blind, `b` big blind, `f` fold,
`k` check, `c` call, `r` bet or raise. A `!` suffix marks an action the engine
chose for that bot (timeout, error, invalid reply or benched). A new street is
a token starting with `|` followed by the new cards.

```
4s10 5b20 6r50 7f 8f 1f 2c50 3f 4f 5c30 |7h8s9d 5k 6r60 2c60 5f |Ts 6k 2k |Jc 6r130 2f!
```

### 4.5 `last_hand`

`{"hand", "board", "log", "shown", "net", "busted"}`: `shown` is a list of
`[seat, [card, card], "category name"]` for every bot at showdown (`[]` if the
hand ended with a fold); `net` is a list of 8 chip changes, index `seat - 1`;
`busted` lists the seats that went out. It is there for any bot still in.
You are not called when a hand ends; read it on your next decision.

### 4.6 `memory`

An empty dict at the start of every table, then the **same dict** on every call
you get at that table. Keep everything you need to remember in it. Module
globals are not reset between tables, and copies of your bot in a test run may
share the module, so do not keep per-table state in globals.

## 5. Timing

* **1 ms per `play` call**, wall-clock (`time.perf_counter_ns`) around the call
  only. The view is built before the clock starts.
* **Over time = fold.** Whatever you returned (even a check, even when nothing
  was owed) is replaced by a fold, and it counts as a timeout. Your call is not
  interrupted; the result is thrown away.
* **Three strikes:** after **3 timeouts in a row** at a table your seat is
  **benched** for the rest of that table: `play` is no longer called and every
  decision is check-if-free, else fold. An in-time call resets the streak.
* **Errors** (an exception or an invalid reply): check if free, else fold, one
  error. No bench for errors.
* **Import + `setup`: 1,000 ms in total, once.** If it raises or takes longer,
  your bot sits out (benched) at every table.
* The grader's machine is not yours, and any machine has the odd scheduler
  hiccup of several ms. Aim well under 0.3 ms. `run_local.py` prints your
  average and slowest call.

## 6. Submission rules

* **One UTF-8 `.py` file, at most 65,536 bytes**, with `NAME`, `play(view, memory)`
  (exactly two positional parameters) and optionally `setup(rules)` (one).
* **Allowed imports** (top-level package): `math random itertools functools
  collections heapq bisect array struct operator typing dataclasses enum string
  json numpy`. No relative imports. **`time`, `os`, `sys` are not allowed.**
* **Not allowed** anywhere in the file: the names `open exec eval compile
  __import__ input breakpoint globals locals vars exit quit help`, and attribute
  access to any `__dunder__` other than `__init__` and `__name__`.
* No files, network, threads or subprocesses. Anything you print is discarded
  (and printing costs time). `random` is not seeded for you at the event.
* `check_submission.py` is the official check: static rules, then import +
  `setup` timing, then 3 smoke tables. Any error rejects the file; timeouts
  only warn. Run it on the exact file you submit.

## 7. Tools

```
python3 run_local.py --bot FILE [--tables 20] [--seed 1] [--opponents A.py B.py ...]
                     [--time-limit-ms 1.0] [--no-timeouts] [--max-hands 200]
                     [--log-dir DIR] [--quiet]
```

Your bot takes one seat per table; the other 7 are the opponents in turn
(default: every sample bot except the template), seats shuffled. The same
`--seed` replays the same tables (the runner also seeds `random`, which the
event does not). Output: one line per table for you, then one row per bot with
seats played, **average points**, average place, wins, errors, timeouts, tables
benched, decisions, average and max ms; then your place counts and your first
problems. `--no-timeouts` measures time but never folds or benches.

`--log-dir` writes `table_<seed>_<n>.jsonl`: **one JSON object per line, one
line per hand**, with `hand level sb bb button names stacks_before hole board
log shown net busted auto` (`hole` shows every bot's cards; `auto` lists
`[seat, street, reason]` for engine-chosen actions).

## 8. Betting fine print

* No limit. The minimum raise adds at least the size of the previous bet or
  raise on this street, and at least one big blind.
* An **all-in raise smaller than a full raise does not reopen the betting** for
  bots that have already acted on this street: they may only call or fold
  (`min_add` is `None`). Bots that have not acted yet may raise.
* The big blind gets its option when everybody calls preflop.
* A short blind (stack below the blind) posts what it has; to call preflop you
  match the largest blind actually posted.
* Side pots are built from each bot's total for the hand. Chips nobody called
  go back to the bettor.
* At showdown every bot still in shows. Split pots are split evenly; odd chips
  go one at a time to the winners in clockwise order starting left of the button.
* If all but one live bot are all-in, the remaining board is dealt without
  betting.

## 9. Sample bots

| File | Style |
|---|---|
| `template_bot.py` | starter: plays pairs and broadways, otherwise check/fold |
| `calling_station.py` | always calls or checks |
| `random_clicker.py` | random fold / call / raise / all-in |
| `shove_monkey.py` | all-in or fold preflop, check/fold after |
| `rock.py` | tight-passive, premium hands only |
| `holdem_habit.py` | decent tight-aggressive bot that still uses the 52-card hand ranking |
| `sixplus_shark.py` | decent tight-aggressive bot that uses the Six-Plus ranking |

## 10. Open questions (answered on the day, maybe)

* The grader's CPU speed. Treat 1 ms as 1 ms on a slower machine.
* How many tables each team plays and how ties in total points are ranked.
* Whether a bot that is benched at many tables is removed from the event.
