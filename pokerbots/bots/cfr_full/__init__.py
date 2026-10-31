"""Approach #5: full-game abstracted CFR.

Modules:
  abstraction.py  equity-bucket card abstraction + batched deal sampler (spec-driven)
  tree.py         abstract betting tree built from a GameSpec (legal under the real rules)
  fasteval.py     bit-identical, 3-10x faster hand evaluator used by the bucketing
  train.py        mini-batch chance-sampled MCCFR (DCFR weighting) + CLI
  parallel.py     multi-process iterations (--workers N): exact, subtree-parallel
  policy.py       save/load of trained policies
  evaluate.py     sampled best-response exploitability estimate in the abstract game
The bot itself is bots/full_cfr.py.
"""
