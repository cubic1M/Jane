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

