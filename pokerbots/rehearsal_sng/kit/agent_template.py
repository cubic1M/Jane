"""Agent template. Copy this file to submission/bot.py and make it better.

The tournament loads your file, finds the class named `Bot`, and creates one
instance per table. decide() is called every time it is your turn to act and
must return an Action within the time limit (see README).
"""

from table_api import CHECK, Action, Agent, HandSummary, Observation


class Bot(Agent):
    def __init__(self) -> None:
        # Not timed per decision (1 second limit). Fresh for every table.
        self.hands_seen = 0

    def decide(self, obs: Observation) -> Action:
        # This template never folds: it checks when it can and calls otherwise.
        if CHECK in obs.legal_actions:
            return Action.check()
        return Action.call()

    def hand_over(self, summary: HandSummary) -> None:
        self.hands_seen += 1
