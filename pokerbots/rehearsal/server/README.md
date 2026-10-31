# Bot protocol and match server

This is the official engine for the event. If this document and the server
disagree, the server is right; please tell us so we can fix the document.

## Running a match locally

```
python3 run_match.py --bot1 "python3 example_bot.py" --bot2 "python3 my_bot/main.py" \
    --hands 1000 --seed 7 --log logs/test.log
```

The server prints each bot's chip result, how many of its decisions timed out or
were illegal, its slowest decision and how much time bank it had left, and writes
a hand-by-hand log (`--log`, default `logs/match_seed<S>.log`) plus each bot's
stderr next to it (`<log>.bot1.stderr`, `<log>.bot2.stderr`). The deal depends only
on `--seed` and the hand number. `bot1` is the dealer on odd-numbered hands and
`bot2` on even-numbered hands.

Tests: `python3 -m unittest discover -s tests` (from this directory).

## Transport

Your bot is a program we start with a shell command. The server writes one JSON
object per line to your **stdin** and reads your answers, one line each, from your
**stdout**.

* Flush stdout after every answer. A Python program whose stdout is a pipe is
  block-buffered by default; an unflushed answer is a timeout.
* Only answer the two message types that ask for an answer (`match_start` and
  `act`). Never write anything else to stdout: write logs and debug output to
  **stderr**. An unexpected line can be read as your answer to the next request.
* Your process is started once per match and should exit after `match_end` (or
  when stdin closes). It is killed 2 seconds later.

## Cards

A card is a string: rank then suit. Ranks are `2 3 4 5 6 7 8 9 10 J Q K A`
(the ten is written `10`, so a card is 2 or 3 characters long); suits are
`s h d c`. Examples: `"Ah"`, `"10d"`, `"7c"`. Case matters.

## Seats

Seats are numbered **per hand**: **seat 0 is the big blind** and **seat 1 is the
dealer**, who posts the small blind. Every list in a message that has one entry
per player (`bets`, `stacks`, `discards`, `shown`) is indexed by seat, and every
entry in `actions` names the seat that acted. Your seat for the hand is in
`seat`. Because the dealer alternates, your seat alternates too.

## Messages from the server

### `match_start` (answer: `ready`)

```json
{"type":"match_start","you":"bot1","hands":1000,"small_blind":5,"big_blind":10,
 "stack":1500,"hole_cards":4,"discard_count":2,"action_timeout":1.0,"time_bank":120.0}
```

Answer with the line `ready` once you have loaded whatever you need. You have 30
seconds; this is not charged to your time bank.

### `hand_start` (no answer)

```json
{"type":"hand_start","hand":17,"seat":0,"hole":["Ah","10d","7c","7s"],"score":-120}
```

`hand` counts from 1. `score` is your chip total in this match before this hand.

### `act` (answer: `<id> <action>`)

Sent whenever it is your turn, both for betting decisions (`phase: "bet"`) and for
the discard (`phase: "discard"`).

```json
{"type":"act","id":53,"hand":17,"seat":0,"street":"flop","phase":"bet",
 "hole":["Ah","7s"],"board":["2c","7h","Ks"],"discards":[["10d","7c"],["Qd","3s"]],
 "pot":20,"bets":[0,0],"stacks":[1490,1490],
 "actions":[[1,"post 5"],[0,"post 10"],[1,"call"],[0,"check"],
            [1,"discard Qd 3s"],[0,"discard 10d 7c"]],
 "to_call":0,"legal":["check","raise"],"raise_by":[10,20],"clock":117.402,"score":-120}
```

| field | meaning |
|---|---|
| `id` | request number; echo it at the start of your answer |
| `hand`, `seat` | hand number (from 1); your seat this hand (0 = big blind, 1 = dealer) |
| `street` | `preflop`, `flop`, `turn` or `river` |
| `phase` | `bet` or `discard` |
| `hole` | your cards (4 before your discard, 2 after) |
| `board` | community cards dealt so far (discards are never board cards) |
| `discards` | face-up discards by seat (dead cards) |
| `pot` | every chip put in this hand by both players, including this street's bets |
| `bets` | chips put in on the current street, by seat (blinds count as preflop bets) |
| `stacks` | chips behind (not yet put in), by seat |
| `actions` | everything that has happened this hand, in order, as `[seat, text]` |
| `to_call` | chips you need to add to call |
| `legal` | the action words you may use now |
| `raise_by` | `[min, max]` for `raise N`, or `null` if you cannot raise |
| `discard_count` | discard phase only: how many cards to discard |
| `clock` | seconds left in your time bank |
| `score` | your chip total in this match before this hand |

### `hand_end` (no answer)

```json
{"type":"hand_end","hand":17,"seat":0,"result":-40,"showdown":true,"folded":null,
 "board":["2c","7h","Ks","4d","9s"],"discards":[["10d","7c"],["Qd","3s"]],
 "shown":[["Ah","7s"],["Kd","Kc"]],"actions":[...],"score":-160}
```

`result` is your chip change for the hand, `score` your match total after it.
`shown` holds both final hands (by seat) when the hand reached showdown, else
`null`. `folded` is the seat that folded, or `null`.

### `match_end` (no answer)

```json
{"type":"match_end","hands":1000,"score":2350}
```

## Your answer to `act`

One line: the request `id`, a space, then the action.

| action | when |
|---|---|
| `53 fold` | facing a bet |
| `53 check` | nothing to call |
| `53 call` | facing a bet (if you have fewer chips than `to_call`, you call all-in) |
| `53 raise N` | `N` is how much you raise **by**, on top of calling; `raise_by[0] <= N <= raise_by[1]` |
| `53 discard Qd 3s` | discard phase: exactly `discard_count` distinct cards from your `hole` |

`raise N` is also how you bet when nothing has been bet yet (then calling costs 0
and `N` is the bet). Example: you are the dealer preflop, `bets` is `[10, 5]`:
`raise 20` puts in 25 more chips (5 to call plus 20), so your bet on this street
becomes 30. `raise_by[1]` already applies the pot limit and both stacks.

Amounts are whole numbers of chips. Action words are not case sensitive; card
names are. Anything that is not exactly one of the legal actions (a word not in
`legal`, an amount outside `raise_by`, a malformed or impossible discard, a
missing id) is illegal, and **an illegal action is a fold**. Amounts are never
rounded or clamped for you. A `fold` when you could have checked is accepted.
An illegal or late discard also folds: you lose what you have put in.

Lines that start with a number other than the current `id` (for example a late
answer to an earlier request) are ignored and the server keeps waiting.

## Time

Time is measured by the server from sending `act` to reading your answer.

* Per decision: 1.0 second. If you do not answer in time, that decision is a
  fold (a missed discard also folds).
* Per match: a 120-second time bank. Each decision's time is subtracted from it.
  When it is empty, the server plays for you for the rest of the match: check if
  possible, otherwise fold, and discard your first two listed cards.
* A bot that crashes is treated the same as one whose bank is empty.

## Files

* `poker.py`: the rules (dealing, betting, discards, showdown, hand evaluator).
* `run_match.py`: process handling, timing and the match loop.
* `example_bot.py`: a simple legal bot; a good starting point for an adapter.
* `tests/`: tests, and `tests/misbehaving_bot.py`, which breaks rules on purpose.
