# Pokerbots Rehearsal Open: official rules

Welcome, and thank you for entering. This year's game is **Heads-Up Pot-Limit
Irish Hold'em**. Please read these rules carefully: the game looks like hold'em,
but several details are different. The bot protocol and the match server we will
run are in `server/` (start with `server/README.md`). Where the rules and the
server disagree, the server decides, and we will correct the rules.

## The game

Every match is between two bots and lasts **1,000 hands**. A standard 52-card
deck is shuffled before every hand.

**Dealer and blinds.** The dealer button alternates every hand. The dealer posts
the small blind of **5 chips** and the other player posts the big blind of
**10 chips**. There are no antes.

**Stacks.** At the start of every hand, both players have **150 big blinds**.
Stacks are reset every hand: the chips you win or lose in a hand are added to
your score for the match, and the next hand starts at 150 big blinds again.

**The deal.** Each player is dealt **four** private cards, face down.

**Preflop.** The dealer acts first before the flop.

**The flop and the discard.** Three community cards are dealt. Then, before
anyone bets on the flop, each player must throw away exactly **two** of their four
cards, keeping two. The dealer discards first and the big blind second, so the big
blind sees the dealer's discards before choosing. Discarded cards are turned
**face up** and stay in front of the player who threw them. They are **dead
cards**: they are not community cards and cannot be used by either player. A
player who is already all-in must still discard.

**Flop, turn and river betting.** After the discard there is a round of betting.
Then one more community card is dealt (the turn) and there is a round of betting,
and one more (the river) followed by a last round of betting. On the flop, turn
and river the **big blind acts first**.

**Showdown.** If neither player folds, each makes the best five-card poker hand
from their two remaining cards and the five community cards, using any
combination of them (both, one, or none of their own cards). Hands rank as in
ordinary hold'em: straight flush, four of a kind, full house, flush, straight,
three of a kind, two pair, one pair, high card. An ace counts high, or low in
A-2-3-4-5. Suits never break ties; equal hands split the pot.

## Betting

The game is **pot limit**.

* The smallest bet on any street is one big blind (10 chips). A raise must
  increase the bet by at least the size of the previous bet or raise on the same
  street.
* The largest bet or raise is the size of the pot: you may raise by as much as
  the pot would contain after you call. For example, the dealer preflop has 5 in,
  faces the big blind's 10, and the pot holds 15. The dealer may call 5 (making the
  pot 20) and raise by up to 20, for a total bet of 30.
* There is no cap on the number of raises. You may always go all-in for less
  than a full raise.

Please note that in the bot protocol, raise amounts are written as how much you
raise **by**, not the total you raise to. See `server/README.md`.

## Time

Each bot has a **time bank of 120 seconds per match**, shared by all its
decisions (bets and discards), and **no single decision may take longer than one
second**. A decision that is not answered within one second is treated as a fold.
A bot whose time bank runs out checks when it can and folds otherwise for the rest
of the match. Loading time at the start of a match (up to 30 seconds) is free.

## Illegal actions

Any action that is not legal at that moment is treated as a **fold**: for
example, a raise that is too small or too large, a check when facing a bet, or a
discard that does not name exactly two of your own cards. An illegal or late
discard loses the hand.

## Scoring

The tournament is a round robin: every bot plays every other bot once. The bot
with more chips at the end of the 1,000 hands **wins the match**; a match that
ends exactly level counts as half a win for each. The standings are by **matches
won**. Ties in the standings are broken by total chips won over all matches, then
by the result of the match between the tied bots.

Note that winning a match by one chip counts exactly as much as winning it by
fifty thousand.

## Technical details

* Your bot is a program that we start with a command you give us. It talks to the
  server over standard input and output. The protocol is in `server/README.md`;
  `server/example_bot.py` is a legal example.
* Matches run on Linux with Python 3.13 and numpy available, one CPU core, 2 GB
  of memory, and no network access.
* Test locally with `server/run_match.py`; it is the same server we will run.

Good luck, and have fun.
