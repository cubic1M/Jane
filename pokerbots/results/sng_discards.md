# discard/draw variants, fair: every bot without its own discard logic uses the shared policy (300 paired tables, fresh seeds 15000+, 2 workers)

## discard_to_board

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_any | 68.64 ± 3.56 | 16% | 77% | 36% | 0.068 | 3.77 | 2 | 0 |
| icm_tag | 65.04 ± 3.96 | 15% | 70% | 41% | 0.066 | 0.93 | 0 | 0 |
| pushfold_icm | 47.90 ± 3.76 | 7% | 54% | 63% | 0.165 | 1.31 | 2 | 0 |
| chen_tag | 42.14 ± 3.29 | 2% | 50% | 66% | 0.177 | 4.32 | 3 | 0 |

paired difference vs icm_any (same tables):
  icm_tag                      -3.59 ± 4.21
  pushfold_icm                 -20.74 ± 4.90 *
  chen_tag                     -26.49 ± 4.95 *

field archetypes (points/table):

## omaha_discard2

