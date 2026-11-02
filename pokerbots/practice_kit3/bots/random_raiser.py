"""Sample bot: loose and random. Raises to random sizes (in big blinds), shoves sometimes."""

import random


class Agent:
    def __init__(self):
        self.rng = random.Random()

    def on_discard_request(self, state):
        return self.rng.choice(state["hole_cards"])

    def on_action_request(self, state):
        x = self.rng.random()
        if state["can_raise"] and x < 0.25:
            bb = state["bb"]
            if self.rng.random() < 0.1:
                return "r 999"
            base = state["current_bet"] / bb
            return "r %.1f" % (base + self.rng.choice([1, 2, 2.5, 3, 5]))
        if x < 0.85 or state["to_call"] == 0:
            return "c"
        return "f"
