"""Approach #4: preflop CFR + balanced postflop.

    abstraction.py  card abstraction (suit classes / equity buckets) and the
                    Monte Carlo bucket-vs-bucket equity matrix
    game.py         abstract preflop betting tree (engine rules), payoffs, translation
    train.py        full-width Discounted CFR and the training CLI
    policy.py       policy file and play-time node tracking
    evaluate.py     exact exploitability and head-to-head CLI
The bot is bots/preflop_cfr.py.
"""
