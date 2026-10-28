# Engine interface (frozen)

Everything a bot or experiment needs. Do not change `engine/` to suit one bot;
if the engine has a bug, report it.

## Cards
`int` 0..51, `rank = c >> 2` (0='2' … 12='A'), `suit = c & 3`.
`engine.cards`: `parse_cards("AsKd")`, `cards_str(cards)`, `rank_of`, `suit_of`.

## GameSpec (`engine/spec.py`), variants (`engine/variants.py`)
Fields: `deck_ranks`, `hole_cards`, `hole_usage` ('any' | 'exactly') + `hole_exact`,
`board_cards_per_street` (street 0 = preflop), `discards` (tuple of
`DiscardRule(street, count, to_board, face_up, order)`), `category_order`,
`ace_low_straight`, `small_blind`, `big_blind`, `ante`, `starting_stack`,
`stack_reset_per_hand`, `hands_per_match`, `betting` ('no_limit' | 'pot_limit'),
`time_per_decision`, `time_per_match` (seconds or None).
Derived: `num_streets`, `deck`, `total_board_dealt`, `final_hole_cards`,
`final_board_cards`, `stack_bb`, `discards_on_street(s)`. `spec.with_(**changes)`.
Specs are hashable (frozen) and can key caches.

Variants: `a_nlhe100`, `b_nlhe200`, `c_discard3` (3 cards, face-up discard to
board after the flop is dealt), `d_omaha4x2` (4 cards, exactly 2, no-limit),
`e_shortdeck`, `f_nlhe20`, `g_pineapple` (3 cards, face-down discard to muck after
the flop is dealt). All have SB=1, BB=2 chips. `get_variant("a")` works.

## Bot (`engine/bot.py`)
```python
class MyBot(Bot):
    name = "mybot"
    def new_match(self, spec, seed=0): super().new_match(spec, seed)  # sets self.spec, self.rng
    def act(self, obs: Observation) -> Action: ...
    def end_hand(self, result: HandResult): ...       # optional
    def end_match(self): ...                           # optional
```
Each bot module exposes `make_bot(**kwargs) -> Bot`; names are mapped in
`bots/registry.py` (`make("balanced")`, `make("balanced+lp")` = with lead protection).

## Actions (`engine/game.py`)
`Fold()`, `Check()`, `Call()`, `RaiseTo(total_on_this_street)`, `Discard(cards)`.
Raise amounts are "raise to": your total pip on this street after the raise,
an `int` within `[legal.min_raise_to, legal.max_raise_to]`.
Illegal action, exception or timeout = fold.

## Observation (frozen dataclass)
`hand_index, hands_in_match, position (0=SB/button, 1=BB), street (0=preflop..),
phase ('bet'|'discard'), my_cards, board (incl. face-up discards sent to the board),
my_discards, opp_discards (visible ones), opp_num_cards, pot (all chips committed
this hand), my_pip, opp_pip (this street), my_stack, opp_stack (behind),
my_committed, opp_committed (this hand), legal: LegalActions, history (ActionRecord
tuples: position, street, kind, amount, visible cards), board_cards_to_come,
my_discards_left, opp_discards_left, bankroll (my match total before this hand),
time_left (match clock or None), big_blind`.

`LegalActions`: `can_fold, can_check, can_call, call_amount, can_raise,
min_raise_to, max_raise_to, discard_count` and helpers `clamp_raise(x)`,
`passive()` (check else call), `is_legal(action, my_cards)`.
In a discard phase only `Discard` of exactly `discard_count` of your cards is legal.

Order of play: blinds (SB = position 0); preflop SB acts first; each later street:
deal board cards, then any discards for that street (rule.order, default BB first),
then betting with BB first. Showdown: both hands revealed in `HandResult.opp_cards`.

## HandResult
`position, delta, showdown, my_cards, opp_cards (None unless showdown), board,
history, folded_by`.

## Equity (`engine/equity.py`)
`m = get_equity_model(spec)`;
`m.equity_obs(obs, n=200, rng=np_rng, opp_sampler=None)` → P(win)+½P(tie) vs one
opponent, honouring future board cards and future discards (see module docstring).
`m.discard_options(obs, n)` → `[(cards_to_discard, equity), ...]` best first.
`m.preflop_equity(cards, n=1500)` → cached by suit class.
`m.equity(my_cards, board, opp_num_cards=, board_to_come=, my_discards_left=,
opp_discards_left=, discard_to_board=, dead=, n=, rng=, opp_sampler=)` low level.
`m.ms_per_sample()` → measured ms per sample on this machine and spec;
size `n` from your time budget instead of hard-coding it (Omaha is ~6x costlier).
`opp_sampler(n, avail_sorted_cards, rng) -> (n, opp_num_cards)` lets a bot plug in
a range. `canonical(cards)` gives a suit-isomorphic key.

## Evaluator (`engine/evaluator.py`)
`ev = get_evaluator(spec)`; `ev.evaluate(hole, board)`;
`ev.evaluate_batch(holes(B,h), boards(B,b))`; `ev.category(score)`. Higher is better.

## Match runner (`engine/match.py`)
`play_match(bot0, bot1, spec, deal_seed, hands=None, record=False)` →
`MatchResult(deltas per hand for seat 0, stats per seat, logs)`.
Positions alternate each hand; dealing depends only on (deal_seed, hand), so
`(A,B)` + `(B,A)` with the same seed is a duplicate pair.

## Conformance
`python -m engine.conformance <name>`: plays every variant vs random-legal and self,
both seats; fails on any illegal action, exception, or decision > 2 s.
A bot is "done" only when this prints `CONFORMANCE OK` and its unit tests pass:
`python -m unittest discover -s bots/tests -t .` (run from `pokerbots/`).
