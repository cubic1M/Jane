"""Sample bot: plays few hands, bets its strong ones."""

from cards import PAIR, RANK_VALUE, THREE_OF_A_KIND, TWO_PAIR, evaluate
from table_api import CALL, CHECK, PREFLOP, RAISE, Action, Agent, Observation


def preflop_strength(hole) -> float:
    """Rough 0-1 score for two hole cards."""
    a, b = RANK_VALUE[hole[0][0]], RANK_VALUE[hole[1][0]]
    hi, lo = max(a, b), min(a, b)
    if a == b:
        return 0.55 + 0.03 * (hi - 6)          # 66 = 0.55, AA = 0.79
    score = 0.025 * (hi - 6) + 0.015 * (lo - 6)
    if hole[0][1] == hole[1][1]:
        score += 0.08
    if hi - lo == 1:
        score += 0.05
    return score + 0.2                          # 76o ~ 0.27, AKs ~ 0.66


class Bot(Agent):
    def decide(self, obs: Observation) -> Action:
        legal = obs.legal_actions
        me = obs.me
        bb = obs.big_blind
        current_bet = me.committed + obs.to_call
        pot_now = obs.pot + sum(p.committed for p in obs.players)

        def passive():
            return Action.check() if CHECK in legal else Action.fold()

        def raise_to(target: int) -> Action:
            if RAISE not in legal:
                return Action.call() if CALL in legal else Action.check()
            return Action.raise_(max(obs.min_raise_to, min(obs.max_raise_to, target)))

        if obs.street == PREFLOP:
            s = preflop_strength(obs.hole)
            if me.stack + me.committed <= 10 * bb:
                return raise_to(obs.max_raise_to) if s >= 0.6 else passive()
            if s >= 0.66:
                return raise_to(current_bet + 2 * bb + pot_now // 2)
            if s >= 0.55 and obs.to_call <= 3 * bb:
                return Action.call() if CALL in legal else Action.check()
            return passive()

        score = evaluate(list(obs.hole) + list(obs.board), validate=False)
        if score[0] >= THREE_OF_A_KIND or (score[0] == TWO_PAIR and obs.to_call == 0):
            return raise_to(current_bet + (2 * (pot_now + obs.to_call)) // 3)
        if score[0] >= PAIR and obs.to_call <= pot_now // 3:
            return Action.call() if CALL in legal else Action.check()
        return passive()
