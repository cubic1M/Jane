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

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_any | 72.25 ± 3.70 | 27% | 78% | 33% | 0.060 | 3.99 | 5 | 0 |
| icm_tag | 68.08 ± 3.99 | 28% | 72% | 38% | 0.064 | 3.18 | 2 | 0 |
| pushfold_icm | 50.84 ± 3.42 | 6% | 58% | 60% | 0.175 | 1.88 | 3 | 0 |
| chen_tag | 49.89 ± 3.14 | 4% | 66% | 56% | 0.185 | 2.08 | 2 | 0 |

paired difference vs icm_any (same tables):
  icm_tag                      -4.17 ± 4.39
  pushfold_icm                 -21.42 ± 4.94 *
  chen_tag                     -22.37 ± 4.94 *

field archetypes (points/table):

## five_draw

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_any | 76.46 ± 3.61 | 28% | 85% | 26% | 0.200 | 4.09 | 6 | 0 |
| icm_tag | 63.44 ± 3.39 | 10% | 78% | 50% | 0.205 | 2.66 | 6 | 0 |
| pushfold_icm | 41.70 ± 3.73 | 6% | 47% | 70% | 0.211 | 1.56 | 5 | 1924 |
| chen_tag | 40.26 ± 2.86 | 0% | 54% | 68% | 0.214 | 2.30 | 10 | 2604 |

paired difference vs icm_any (same tables):
  icm_tag                      -13.01 ± 4.18 *
  pushfold_icm                 -34.75 ± 4.80 *
  chen_tag                     -36.20 ± 4.52 *

first error: Traceback (most recent call last):
