# discard/draw variants, fair: every bot without its own discard logic uses the shared policy (300 paired tables, fresh seeds 15000+, 2 workers)

## discard_to_board

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_any | 66.97 ± 3.47 | 14% | 77% | 39% | 0.068 | 0.71 | 0 | 0 |
| icm_tag | 65.43 ± 3.94 | 23% | 72% | 41% | 0.066 | 2.11 | 2 | 0 |
| pushfold_icm | 52.73 ± 3.84 | 11% | 60% | 54% | 0.172 | 1.07 | 1 | 0 |
| chen_tag | 45.20 ± 3.43 | 4% | 56% | 59% | 0.180 | 2.57 | 3 | 0 |

paired difference vs icm_any (same tables):
  icm_tag                      -1.53 ± 4.47
  pushfold_icm                 -14.23 ± 4.84 *
  chen_tag                     -21.77 ± 4.43 *

field archetypes (points/table):

## omaha_discard2

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_any | 70.18 ± 3.64 | 18% | 79% | 31% | 0.072 | 2.78 | 3 | 0 |
| icm_tag | 69.43 ± 3.93 | 26% | 74% | 32% | 0.073 | 3.46 | 7 | 0 |
| pushfold_icm | 51.62 ± 3.77 | 11% | 59% | 57% | 0.188 | 0.87 | 0 | 0 |
| chen_tag | 50.43 ± 3.10 | 1% | 66% | 55% | 0.195 | 5.45 | 2 | 0 |

paired difference vs icm_any (same tables):
  icm_tag                      -0.75 ± 4.79
  pushfold_icm                 -18.56 ± 4.94 *
  chen_tag                     -19.75 ± 4.53 *

field archetypes (points/table):

## draw_holdem

