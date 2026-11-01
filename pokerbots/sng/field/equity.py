"""Vectorised Monte Carlo equity against uniformly random opponent hands.

One call deals `samples` random completions (every live opponent's hole cards plus the
rest of the board) and evaluates them in a single evaluate_batch call. Equity =
P(win) + 0.5 P(tie), the textbook version a team writes with Codex in ten minutes.
"""
from __future__ import annotations

import time

import numpy as np

from engine.evaluator import get_evaluator


class McEquity:
    def __init__(self, spec, seed):
        self.spec = spec
        self.ev = get_evaluator(spec)
        self.h = spec.hole_cards
        self.deck = np.array(spec.deck, dtype=np.int64)
        self.rng = np.random.default_rng(seed)

    def _unseen(self, hole, board):
        dead = np.array(list(hole) + list(board), dtype=np.int64)
        return self.deck[~np.isin(self.deck, dead)]

    def _batch(self, hole, board, unseen, opps, samples):
        """Returns the summed equity over `samples` deals."""
        h, nb = self.h, self.spec.total_board_dealt - len(board)
        need = opps * h + nb
        idx = np.argsort(self.rng.random((samples, len(unseen))), axis=1)[:, :need]
        draw = unseen[idx]
        boards = np.empty((samples, len(board) + nb), dtype=np.int64)
        boards[:, :len(board)] = board
        boards[:, len(board):] = draw[:, opps * h:]
        holes = np.empty(((opps + 1) * samples, h), dtype=np.int64)
        holes[:samples] = hole
        for i in range(opps):
            holes[(i + 1) * samples:(i + 2) * samples] = draw[:, i * h:(i + 1) * h]
        sc = self.ev.evaluate_batch(holes, np.tile(boards, (opps + 1, 1))).reshape(opps + 1, samples)
        best = sc[1:].max(axis=0)
        return float((sc[0] > best).sum() + 0.5 * (sc[0] == best).sum())

    def fixed(self, hole, board, opps, samples):
        """Equity from exactly `samples` deals (no time limit)."""
        opps = max(1, opps)
        return self._batch(hole, board, self._unseen(hole, board), opps, samples) / samples

    def timeboxed(self, hole, board, opps, t0, budget, cost_per_eval, overhead, max_samples=2000):
        """Sample in batches until `budget` seconds after t0 would be exceeded.
        Returns (equity or None, samples used, updated cost per evaluation)."""
        opps = max(1, opps)
        unseen = self._unseen(hole, board)
        total = 0.0
        n = 0
        while n < max_samples:
            left = budget - (time.perf_counter() - t0)
            per_sample = cost_per_eval * (opps + 1)
            k = int((left - overhead) / per_sample) if left > overhead else 0
            k = min(k, 64, max_samples - n)
            if k < 1:
                break
            t = time.perf_counter()
            total += self._batch(hole, board, unseen, opps, k)
            n += k
            dt = time.perf_counter() - t
            cost_per_eval = 0.7 * cost_per_eval + 0.3 * max(0.0, dt - overhead) / (k * (opps + 1))
        return (total / n if n else None), n, cost_per_eval

    def calibrate(self, opps=1, samples=32, reps=5):
        """Measure (fixed overhead, cost per evaluation) of a batch on this machine."""
        hole = tuple(int(c) for c in self.deck[:self.h])
        board = tuple(int(c) for c in self.deck[self.h:self.h + 3])
        unseen = self._unseen(hole, board)

        def t(k):
            best = 1e9
            for _ in range(reps):
                s = time.perf_counter()
                self._batch(hole, board, unseen, opps, k)
                best = min(best, time.perf_counter() - s)
            return best

        small, big = t(1), t(samples)
        cost = max(1e-7, (big - small) / ((samples - 1) * (opps + 1)))
        return max(0.0, small - cost * (opps + 1)), cost
