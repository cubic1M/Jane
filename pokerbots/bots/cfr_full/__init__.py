"""Approach #5: full-game abstracted CFR.

Modules:
  abstraction.py  equity-bucket card abstraction + batched deal sampler (spec-driven)
  tree.py         abstract betting tree built from a GameSpec (legal under the real rules)
  train.py        mini-batch chance-sampled MCCFR (DCFR weighting) + CLI
  policy.py       save/load of trained policies
  evaluate.py     sampled best-response exploitability estimate in the abstract game
The bot itself is bots/full_cfr.py.
"""
