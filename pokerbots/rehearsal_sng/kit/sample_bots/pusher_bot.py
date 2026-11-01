"""Sample bot: shoves or folds preflop when short, otherwise plays fit-or-fold."""

from cards import PAIR, RANK_VALUE, evaluate
from table_api import CALL, CHECK, PREFLOP, RAISE, Action, Agent, Observation


class Bot(Agent):
    def decide(self, obs: Observation) -> Action:
        legal = obs.legal_actions
        me = obs.me
        bb = obs.big_blind
        passive = Action.check() if CHECK in legal else Action.fold()

        if obs.street == PREFLOP:
            a, b = (RANK_VALUE[c[0]] for c in obs.hole)
            good = a == b or max(a, b) == 14 or (min(a, b) >= 11)
            if (me.stack + me.committed) <= 15 * bb:
                if good and RAISE in legal:
                    return Action.raise_(obs.max_raise_to)
                if good and CALL in legal:
                    return Action.call()
                return passive
            if good and obs.to_call <= 4 * bb:
                return Action.call() if CALL in legal else Action.check()
            return passive

        score = evaluate(list(obs.hole) + list(obs.board), validate=False)
        if score[0] >= PAIR:
            return Action.call() if CALL in legal else Action.check()
        return passive
