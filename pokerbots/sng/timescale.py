"""Timing-test scale for slower hosts.

The tests' absolute limits (e.g. p99 < 0.2 ms) were set on the development machine. A slower
host (a cloud container on another CPU) makes every decision uniformly slower; an absolute
limit then tests the host, not the code. factor() returns SNG_TIME_SCALE (default 1, clamped
to 1..3) and the timing tests multiply their limits by it. Set it deliberately, e.g.
SNG_TIME_SCALE=1.5 on a host where the unchanged code measures 1.5x slower, never to hide a
regression. (An automatic calibration was tried and rejected: no simple loop tracks decision
latency across hosts reliably.)

The event's real limit is 1 ms per decision on the organisers' machine: keep the bot's p99 far
below that on any host.
"""
from __future__ import annotations

import os


def factor() -> float:
    try:
        return min(3.0, max(1.0, float(os.environ.get("SNG_TIME_SCALE", "1"))))
    except ValueError:
        return 1.0
