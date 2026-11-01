# discard/draw variants (300 paired tables each, default field, fresh seeds 13000+)

## discard_to_board

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_any | 65.37 ± 3.73 | 11% | 74% | 38% | 0.079 | 24.10 | 599 | 0 |
| icm_tag | 70.19 ± 3.77 | 21% | 77% | 33% | 0.085 | 80.24 | 518 | 7621 |
| pushfold_icm | 51.56 ± 3.95 | 10% | 58% | 55% | 0.391 | 20.12 | 575 | 2946 |
| chen_tag | 50.23 ± 3.34 | 3% | 64% | 50% | 0.340 | 35.11 | 599 | 3219 |

paired difference vs icm_any (same tables):
  icm_tag                      +4.82 ± 4.76 *
  pushfold_icm                 -13.81 ± 5.06 *
  chen_tag                     -15.13 ± 4.96 *

first error: illegal check with Legal(can_check=False, can_call=False, call_amount=0, can_raise=False, min_raise_to=0, max_raise_to=0, discard_count=1, discard_min=1)

## omaha_discard2

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_any | 72.71 ± 3.57 | 20% | 81% | 29% | 0.093 | 32.09 | 660 | 0 |
| icm_tag | 63.19 ± 3.99 | 16% | 68% | 42% | 0.086 | 28.13 | 576 | 7797 |
| pushfold_icm | 42.52 ± 3.37 | 2% | 49% | 71% | 0.922 | 19.85 | 570 | 2812 |
| chen_tag | 46.85 ± 3.11 | 1% | 58% | 59% | 1.862 | 24.09 | 684 | 3123 |

paired difference vs icm_any (same tables):
  icm_tag                      -9.52 ± 4.75 *
  pushfold_icm                 -30.19 ± 4.64 *
  chen_tag                     -25.85 ± 4.64 *

first error: illegal check with Legal(can_check=False, can_call=False, call_amount=0, can_raise=False, min_raise_to=0, max_raise_to=0, discard_count=2, discard_min=2)

## draw_holdem

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_any | 68.07 ± 3.78 | 24% | 72% | 38% | 0.071 | 16.12 | 493 | 0 |
| icm_tag | 65.25 ± 4.15 | 25% | 68% | 39% | 0.075 | 31.26 | 506 | 8680 |
| pushfold_icm | 46.07 ± 3.55 | 6% | 53% | 64% | 0.291 | 32.25 | 474 | 2848 |
| chen_tag | 42.84 ± 2.98 | 1% | 54% | 62% | 0.300 | 18.26 | 571 | 3298 |

paired difference vs icm_any (same tables):
  icm_tag                      -2.82 ± 4.86
  pushfold_icm                 -22.00 ± 5.01 *
  chen_tag                     -25.23 ± 4.97 *

first error: illegal check with Legal(can_check=False, can_call=False, call_amount=0, can_raise=False, min_raise_to=0, max_raise_to=0, discard_count=1, discard_min=0)

## five_draw

multiprocessing.pool.RemoteTraceback: 
"""
Traceback (most recent call last):
  File "/usr/lib/python3.13/multiprocessing/pool.py", line 125, in worker
    result = (True, func(*args, **kwds))
                    ~~~~^^^^^^^^^^^^^^^
  File "/usr/lib/python3.13/multiprocessing/pool.py", line 48, in mapstar
    return list(map(*args))
  File "/home/user/Jane/pokerbots/sng/arena.py", line 71, in _table_job
    res = play_table(bots, rules, seed=seed0 * 100003 + t, deal_seed=seed0 * 100003 + t)
  File "/home/user/Jane/pokerbots/sng/table.py", line 414, in play_table
    b.new_table(rules, s, seed * 1000 + s)
    ~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^
done
