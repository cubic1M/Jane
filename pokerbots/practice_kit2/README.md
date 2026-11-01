# Pocket Swap Hold'em: bot starter kit

Practice kit for a 60-minute bot-building tournament. You write one Python
file. It plays 8-bot sit-and-go tables of **no-limit hold'em with one extra
step: after the flop betting, each bot may swap one hole card** (the "draw",
see section 3). This kit has the rules, the interface, a local simulator,
an ICM calculator, a template bot, three sample bots and a submission checker.

Everything here targets **Python 3.13** and uses only the standard library.
Bots may use numpy (see "Allowed imports"). The kit never needs it.

```
practice_kit2/
  README.md            this file (the rules)
  bots/template_bot.py start here: copy it, rename it, edit it
  bots/sample_*.py     three opponents: sample_tight, sample_caller, sample_shover
  run_local.py         local tournament runner
  check_bot.py         the submission check (imports, single file, get_action)
  simkit/              the simulator (NOT available to your bot on the grader)
    rules.py           every number in this README, in one place
    table.py           the game engine
    agent.py           loading bots, the clock, the JSON round trip
    cards.py           cards and a 7-card evaluator
    icm.py             ICM calculator (Malmuth-Harville)
  tests/               unittest suite for the simulator
```

## Quick start

```
cd practice_kit2
cp bots/template_bot.py bots/my_bot.py
python3 check_bot.py bots/my_bot.py
python3 run_local.py --bot bots/my_bot.py --tables 20
python3 run_local.py --bot bots/my_bot.py --tables 5 --log-dir logs   # hand logs
python3 -m unittest discover -s tests                                 # simulator tests
```

---

## 1. Tournament format

| | |
|---|---|
| Table | 8 bots, sit-and-go. Seats are shuffled for each table. |
| Starting stack | 2,000 chips |
| Blinds | Start at 10/20 and go up every 25 hands (schedule below) |
| Antes | From level 4. Every bot dealt in pays one ante. |
| Table ends | When one bot has all the chips, **or** after hand 200 |
| Decision clock | 1 ms per decision (section 5) |
| Bot state | Your module is loaded fresh for every table |

**Blind schedule** (level *k* covers hands 25(k-1)+1 to 25k; level 8 runs to the end):

| Level | Hands | Small blind | Big blind | Ante |
|---|---|---|---|---|
| 1 | 1-25 | 10 | 20 | 0 |
| 2 | 26-50 | 15 | 30 | 0 |
| 3 | 51-75 | 25 | 50 | 0 |
| 4 | 76-100 | 50 | 100 | 10 |
| 5 | 101-125 | 75 | 150 | 15 |
| 6 | 126-150 | 100 | 200 | 25 |
| 7 | 151-175 | 150 | 300 | 40 |
| 8 | 176-200 | 200 | 400 | 50 |

**Points.** Each table shares a pool of **1000 points**. The 1st place is listed first:

| Place | 1st | 2nd | 3rd | 4th | 5th | 6th | 7th | 8th |
|---|---|---|---|---|---|---|---|---|
| Points | 350 | 220 | 150 | 100 | 75 | 50 | 35 | 20 |

* A bot knocked out takes the worst place still open.
* If several bots are knocked out **in the same hand**, the one that started
  that hand with more chips finishes higher. Bots that started the hand with
  exactly the same stack split the points of the places they take (two bots
  tied for 3rd/4th get (150+100)/2 = 125 each).
* **At the hand cap** (after hand 200 with 2+ bots left) the survivors split
  the points of the places still open by **ICM** on their chip counts:
  Malmuth-Harville, the same as `simkit/icm.py`. Example: 3 survivors split
  350+220+150 = 720 points. Having the most chips does **not** give you
  1st place's 350.
* Your tournament score is your **average points per table** over all the
  tables you play. The organisers decide how many tables there are and who
  sits at them. Expect a mix of other teams' bots and house bots.

## 2. Cards and seats

**Cards** are 2-3 character strings: rank then suit. Ranks are
`2 3 4 5 6 7 8 9 10 J Q K A` (ten is **`10`**, not `T`). Suits are upper
case: `C D H S`. Examples: `"10H"`, `"AS"`, `"7C"`. The rank is `card[:-1]`
and the suit is `card[-1]`.

**Seats are numbered from the button, and the numbers change every hand.**
The button is seat 0. Seat 1 is the next bot clockwise, and so on up to
`num_seats - 1`. Only bots still in the tournament get a seat, so after a
knockout the numbers close up. The button moves one bot clockwise each hand.
If that bot was just knocked out, it goes to the next bot still playing
(there is no dead button). The state never gives names or ids, only seats.

* 3+ bots: seat 1 posts the small blind and seat 2 the big blind.
  Preflop action starts at seat 3 (seat 0, the button, when 3-handed).
  After the flop, action starts at seat 1 and the button acts last.
* **Heads-up (2 bots): the button (seat 0) posts the small blind and acts
  first preflop.** Seat 1 posts the big blind and acts first after the flop.

## 3. The twist: the draw

The hand is dealt and bet like no-limit hold'em, with one extra step:

1. Preflop betting
2. Flop (3 cards), flop betting
3. **Draw.** Each bot that has not folded is asked once, in post-flop
   order (seat 1 first, button last). It may **discard 0 or 1 of its hole
   cards**. A discarded card is replaced at once by the next card of the
   deck, face down. Discarded cards are dead: nobody sees them and they
   never come back. Bots that are **all-in still draw**. There is no betting
   during the draw.
4. Turn, turn betting
5. River, river betting, showdown (best 5 of your 2 hole cards + 5 board cards)

* The draw happens only if 2+ bots are still in after the flop betting. It
  happens even when no more betting is possible (for example everyone is
  all-in). The board is then run out after the draw.
* Everybody can see **how many** cards each bot drew: `players[i]["drew"]`
  (`null` before that bot has drawn, then `0` or `1`) and a `"draw"` entry
  in `history`. Nobody sees which card was thrown away or what came in.
* Your `hole_cards` after the draw are your new cards. Re-read them every
  time.

## 4. The bot interface

Submit **one `.py` file** with these module-level functions:

```python
def init(config: dict) -> None          # optional; once per table
def get_action(state: dict) -> dict     # required; every decision
def on_hand_end(summary: dict) -> None  # optional; after every hand you were dealt into
```

Your file is imported again at the start of **every table**, so module
globals start fresh at each table and `init` runs again. Within a table,
globals carry over from hand to hand.

### 4.1 `init(config)`

```python
{
  "starting_stack": 2000, "num_players": 8, "max_hands": 200, "hands_per_level": 25,
  "blind_schedule": [{"level": 1, "small_blind": 10, "big_blind": 20, "ante": 0}, ...],
  "payouts_per_mille": [350, 220, 150, 100, 75, 50, 35, 20],
  "time_limit_ms": 1.0, "init_time_limit_ms": 500.0, "draw_after_flop": true
}
```

### 4.2 `get_action(state)`: the state

`get_action` is called for every betting decision **and** for the draw.
`state["type"]` says which: `"action"` or `"draw"`.

| key | meaning |
|---|---|
| `type` | `"action"` (betting) or `"draw"` |
| `hand_number` | 1-based hand number at this table |
| `hands_remaining` | hands left before the cap, not counting this one (`200 - hand_number`) |
| `level`, `small_blind`, `big_blind`, `ante` | current level |
| `hands_left_in_level` | hands still to play at this level after this one; `null` on level 8 |
| `street` | `"preflop"`, `"flop"`, `"draw"`, `"turn"`, `"river"` |
| `board` | community cards so far |
| `hole_cards` | your two cards, **as they are now** |
| `my_seat` | your seat (button = 0) |
| `num_seats` | bots dealt into this hand |
| `pot` | chips in the pot from **earlier rounds and antes**. **Does not include bets made in the current round.** |
| `current_bet` | the most chips any bot has put in during this round (the amount to match) |
| `min_raise_by` | the smallest legal raise **increment** right now |
| `can_raise` | whether a raise is allowed right now (see 4.3) |
| `players` | one entry per seat, **in seat order** (`players[k]["seat"] == k`), including folded and all-in bots |
| `history` | every action of this hand so far, in order (below) |
| `time_limit_ms` | 1.0 |

Each `players` entry:

| key | meaning |
|---|---|
| `seat` | seat number |
| `chips_total` | the bot's chips **including what it has put in during the current round** (not earlier rounds) |
| `chips_in_pot_this_round` | chips put in during the current round (blinds count; antes do not) |
| `status` | `"active"`, `"folded"` or `"allin"` |
| `drew` | `null` until that bot has drawn this hand, then `0` or `1` |

Useful derived numbers:

```python
me        = state["players"][state["my_seat"]]
to_call   = state["current_bet"] - me["chips_in_pot_this_round"]
behind    = me["chips_total"] - me["chips_in_pot_this_round"]      # chips you can still put in
pot_now   = state["pot"] + sum(p["chips_in_pot_this_round"] for p in state["players"])
all_in_by = me["chips_total"] - state["current_bet"]               # raise-by that puts you all-in
```

`history` entries look like `{"street": "preflop", "seat": 3, "action": "raise", "amount": 40, "to": 60}`.
`action` is one of `ante`, `small_blind`, `big_blind`, `fold`, `check`,
`call`, `raise`, `draw`. `amount` is the chips put in for antes, blinds and
calls. For a raise it is the raise-by increment, and `to` is the new
`current_bet`. For a draw it is the number of cards drawn (0/1). An entry
with `"auto": true` was played for that bot because of a timeout, an error
or an invalid reply.

On the draw (`type == "draw"`), `current_bet` and `min_raise_by` are 0 and
`can_raise` is false.

### 4.3 Your reply

**Betting** (`type == "action"`):

```python
{"action": "fold"}
{"action": "check"}
{"action": "call"}
{"action": "raise", "amount": 60}     # raise BY 60 over current_bet
```

* **`amount` is a raise-BY, not a raise-to.** Your new total for this round
  will be `current_bet + amount`. Example: big blind 20, nobody has raised,
  you send `{"action": "raise", "amount": 40}`. That makes it 60 to play,
  and you put in `60 - chips_in_pot_this_round`. Opening a bet after the
  flop is also a `raise` (from `current_bet` 0). There is no `bet` or
  `allin` action.
* `amount` must be a JSON integer greater than 0. `40.0`, `"40"` and `true`
  are invalid.
* If `amount` is below `min_raise_by`, it is raised to `min_raise_by`.
  If it is more than you have, it is cut to your all-in
  (`chips_total - current_bet`).
* `min_raise_by` starts at the big blind each round. After a raise it is
  the size of the largest raise so far in the round.
* An all-in raise smaller than `min_raise_by` is allowed, but it does not
  reopen the betting. Bots that had already acted since the last full raise
  may only call or fold, and their `can_raise` is false.
* When `can_raise` is false (also when nobody else can respond, or when you
  cannot put in more than the call), a `raise` reply is played as a
  **call** (or a check if nothing is owed). This does not count as an error.
* `call` with nothing owed is played as a check. If you cannot cover the
  call, `call` puts you all-in for what you have.
* `check` while facing a bet is **invalid** (see below). `fold` is always
  accepted, even when checking is free.
* Action names are case-sensitive, lower case.

**Preflop, the bet to match is always the full big blind**, even if the
big-blind bot is all-in for less. Any chips nobody else could match come back
to whoever put them in.

**Draw** (`type == "draw"`):

```python
{"discard": "10H"}     # one of your current hole cards, written exactly as given
{"discard": null}      # keep both  (Python: None)
```

**Invalid replies, timeouts and errors.** An exception, a reply over the
time limit, a reply that is not JSON-serialisable, or a reply that is not
one of the forms above is replaced by a default:

* betting: **check if checking is free, otherwise fold**
* draw: **keep both cards**

These are counted as errors (or timeouts) in the runner output.

### 4.4 `on_hand_end(summary)`

Called once for every bot that was dealt into the hand. This includes the
hand in which you are knocked out.

```python
{
  "hand_number": 27, "my_seat": 2, "my_hole_cards": ["KC", "10D"],   # after the draw
  "board": ["10H", "AS", "3D", "7C", "QD"],    # fewer than 5 if the hand ended early
  "showdown": [{"seat": 2, "hole_cards": [...], "hand": "two pair"}, ...],   # [] if no showdown
  "pots": [{"amount": 450, "eligible": [1, 2], "winners": [2]}, ...],         # main pot first
  "net": {"0": -20, "1": 0, "2": 230, ...},           # chip change this hand, by seat
  "chips_after": {"0": 1840, ...},                    # stacks after the hand, by seat
  "knocked_out_seats": [5],
  "history": [...]
}
```

The summary passes through JSON like everything else, **so object keys are
strings** (`summary["net"]["2"]`, not `summary["net"][2]`). Seats are this
hand's seats. All bots still in at showdown show their cards. If the betting
ended early because of all-ins, the board is run out to 5 cards first.
`on_hand_end` gets the same 1 ms limit.
Its errors and timeouts are counted, but it has no effect on the game.

## 5. Timing

* **1 ms per decision, wall clock.** The clock covers the whole call:
  serialising the state with `json.dumps`, `json.loads` into the dict you
  receive, your `get_action`, then `json.dumps`/`json.loads` of your reply.
  A big state (late in a long hand) or a big reply uses part of your 1 ms.
* The draw is a decision and gets the same 1 ms.
* **Init: 500 ms per table**, covering the import of your file (all
  module-level code and imports, numpy included) plus `init(config)`. A bot
  whose init raises or runs over the limit **sits out the whole table**:
  every decision gets the default (check if free, otherwise fold; keep
  both cards on the draw), so the blinds slowly take its chips.
* The grader runs bots one at a time on its own hardware. We do not promise
  that it matches your laptop. Python garbage collection and the OS can add
  occasional spikes, and those count. Leave a margin.
* Locally a slow call is not interrupted. It finishes, is measured, and its
  reply is thrown away. `--no-timeouts` measures but never throws away.
* `random` is not seeded for you. Time-based logic is allowed (`time` is an
  allowed import).

## 6. Submission rules

* One `.py` file, at most 100,000 bytes, with a module-level `get_action`.
  No `async def`.
* **Allowed imports** (nothing else, and no relative imports):
  `__future__ math random itertools functools collections heapq bisect json time
  statistics typing dataclasses enum operator array copy numpy`.
  numpy is version 2.x if you use it. Note that importing numpy is part of
  your init time.
* `simkit` is **not** on the grader. Copy any helper you need into your file.
* Not allowed: `open exec eval compile __import__ input breakpoint globals
  vars setattr delattr`, and attribute access to `__import__`,
  `__builtins__`, `__subclasses__`, `__globals__`, `__code__`.
* `python3 check_bot.py your_bot.py` runs the same static check as the
  submission form.
* Return plain JSON types: dict, list, str, int, float, bool, None. NaN is
  not allowed, and neither are sets, tuples as keys, or numpy scalars such
  as `np.int64` (convert with `int(x)`).

## 7. Local runner

```
python3 run_local.py --bot bots/my_bot.py --tables 20
  --bot PATH            your bot (repeat to seat several of your own bots)
  --opponents A,B,C     files that fill the other seats, used in turn
                        (default: bots/sample_tight.py,bots/sample_caller.py,bots/sample_shover.py)
  --tables N            number of tables (default 20)
  --players N           bots per table, 2-8 (default 8; the event uses 8)
  --max-hands N         hand cap (default 200)
  --seed N              seeds seating and decks (default 1)
  --time-limit-ms X     default 1.0
  --no-timeouts         measure time, never discard slow replies
  --log-dir DIR         write DIR/table_NNN.log hand logs
  --skip-check          run even if check_bot.py rejects your file
```

The runner prints one row per bot file: seats played, **average points per
table**, average place, wins, errors, timeouts, decisions, average and
slowest decision time (ms), the slowest init (ms) and init failures. Then it
prints the first problems your bot had. Copies of the same opponent file are
added together. With fewer than 8 players locally, only the first N places
of the points table are paid.

A hand log looks like this:

```
=== Table 1 | hand 1 | level 1 (10/20, ante 0) ===
  seat 0 sample_shover 2000 | seat 1 sample_shover#2 2000 | seat 2 sample_tight 2000 | ...
  seat 1 sample_shover#2 posts small blind 10
  seat 2 sample_tight posts big blind 20
  hole: sample_shover [KS 3D] | sample_shover#2 [8S 9D] | sample_tight [6C 2H] | ...
  PREFLOP: seat 3 sample_caller#2 calls 20
  PREFLOP: seat 4 sample_tight#3 folds
  ...
  FLOP [JS 3C AS]  pot 70
  FLOP: seat 2 sample_tight checks
  DRAW: seat 2 sample_tight discards 2H, draws JD
  DRAW: seat 7 sample_caller stands pat
  TURN [JS 3C AS 6D]  pot 70
  TURN: seat 2 sample_tight raises by 35 to 35
  ...
  SHOWDOWN board [JS 3C AS 6D 10D]
    seat 2 sample_tight [6C JD] two pair
  main pot 436: sample_tight
```

The log shows every hole card and every discard. Your bot never sees those.

## 8. Fine print

* **Order of dealing.** The deck is shuffled each hand. Hole cards are dealt
  one at a time starting at seat 1. Then the flop, then draw replacements
  in draw order, then turn and river. No burn cards.
* **Side pots.** Pots are layered by how much each bot put in during the
  whole hand, antes included. Folded bots' chips stay in the pots, but those
  bots cannot win them. A layer only one bot reached goes back to that bot.
* **Split pots.** The pot is split evenly. Odd chips go one at a time to the
  winners in order starting from seat 1, with the button last.
* **Short blinds and antes.** A bot that cannot cover an ante or a blind
  posts what it has and is all-in. The ante is taken first.
* **Chip leader at the cap** does not get first-place points. See section 1.

### Known open questions (we will answer on the day, maybe)

* Exactly how many tables each bot plays, and how many house bots are in the field.
* The grader's CPU. Treat 1 ms as 1 ms on a machine somewhat slower than yours.
* Whether repeated timeouts or errors get a bot removed from the event.
  Locally they never do.
* Ties in the final tournament standings.

## 9. Sample bots

| file | style |
|---|---|
| `template_bot.py` | Correct and minimal. Shows the interface, card parsing, raise-by and the draw. |
| `sample_tight.py` | Chen-style preflop, a small made-hand reader postflop, a sensible draw. |
| `sample_caller.py` | Calling station. Never raises, draws at random. |
| `sample_shover.py` | Push/fold when short, fit-or-fold postflop, never draws. |

The simulator's own tests (`python3 -m unittest discover -s tests`) also
cover these rules: raise-by, defaults, side pots, the draw, the clock, ICM.
They are worth reading if a rule above is unclear.
