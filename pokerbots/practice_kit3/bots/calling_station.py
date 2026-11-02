"""Sample bot: calls (or checks) everything, never raises. Keeps its two highest cards."""


class Agent:
    def on_discard_request(self, state):
        return min(state["hole_cards"], key=lambda c: c % 13)

    def on_action_request(self, state):
        return "c"
