import os
import sys
sys.path.insert(0, os.environ.get("POKERBOTS_ROOT", "."))
from skeleton import actions
from skeleton.runner import parse_args, run_bot
from skeleton.bot import Bot
from tournament.mit_adapter import AdaptedPlayer
import os

class Player(Bot):
    def __init__(self):
        self.p = AdaptedPlayer(os.environ.get("OUR_BOT", "balanced"), os.environ.get("OUR_VARIANT", "c_discard3"), actions_module=actions)
    def handle_new_round(self, g, r, a):
        self.p.handle_new_round(g, r, a)
    def handle_round_over(self, g, t, a):
        self.p.handle_round_over(g, t, a)
    def get_action(self, g, r, a):
        return self.p.get_action(g, r, a)

if __name__ == "__main__":
    run_bot(Player(), parse_args())
