# icm_tag robustness 2: variants and blind schedules (fresh seeds 7100+, 300 paired tables per cell)

## --variant e_shortdeck

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 71.79 ± 3.45 | 21% | 81% | 34% | 0.051 | 6.39 | 3 | 0 |
| pushfold_icm | 50.57 ± 3.51 | 8% | 59% | 60% | 0.168 | 2.33 | 4 | 0 |
| adaptive | 51.35 ± 3.63 | 7% | 60% | 52% | 0.176 | 1.46 | 5 | 0 |
| chen_tag | 47.45 ± 3.19 | 4% | 61% | 58% | 0.174 | 11.83 | 7 | 0 |

paired difference vs icm_tag (same tables):
  pushfold_icm                 -21.22 ± 4.80 *
  adaptive                     -20.44 ± 4.77 *
  chen_tag                     -24.34 ± 4.40 *


## --variant d_omaha4x2

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 67.10 ± 3.28 | 11% | 80% | 43% | 0.070 | 5.57 | 6 | 0 |
| pushfold_icm | 46.23 ± 3.77 | 7% | 52% | 65% | 0.087 | 4.14 | 2 | 0 |
| adaptive | 44.88 ± 3.63 | 4% | 53% | 62% | 0.098 | 8.15 | 6 | 0 |
| chen_tag | 41.37 ± 3.30 | 3% | 52% | 67% | 0.090 | 1.22 | 1 | 0 |

paired difference vs icm_tag (same tables):
  pushfold_icm                 -20.87 ± 4.79 *
  adaptive                     -22.22 ± 4.50 *
  chen_tag                     -25.73 ± 4.20 *


## --betting pot_limit

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 64.15 ± 3.71 | 12% | 72% | 38% | 0.057 | 8.13 | 20 | 0 |
| pushfold_icm | 54.48 ± 3.54 | 7% | 67% | 52% | 0.183 | 8.33 | 37 | 0 |
| adaptive | 46.86 ± 3.06 | 1% | 63% | 55% | 0.190 | 8.46 | 36 | 0 |
| chen_tag | 46.40 ± 3.04 | 2% | 61% | 54% | 0.185 | 23.51 | 25 | 0 |

paired difference vs icm_tag (same tables):
  pushfold_icm                 -9.67 ± 4.78 *
  adaptive                     -17.29 ± 4.43 *
  chen_tag                     -17.75 ± 4.31 *


## --blinds fast

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 58.30 ± 4.20 | 36% | 64% | 63% | 0.055 | 10.31 | 16 | 0 |
| pushfold_icm | 51.91 ± 4.24 | 32% | 55% | 68% | 0.169 | 11.53 | 9 | 0 |
| adaptive | 43.21 ± 3.25 | 8% | 54% | 85% | 0.188 | 4.23 | 8 | 0 |
| chen_tag | 44.44 ± 3.07 | 7% | 58% | 86% | 0.178 | 12.05 | 6 | 0 |

paired difference vs icm_tag (same tables):
  pushfold_icm                 -6.39 ± 5.38 *
  adaptive                     -15.09 ± 4.83 *
  chen_tag                     -13.85 ± 4.98 *


## --blinds slow

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 57.81 ± 2.99 | 1% | 77% | 25% | 0.060 | 8.15 | 129 | 0 |
| pushfold_icm | 47.35 ± 2.50 | 1% | 77% | 26% | 0.181 | 8.28 | 122 | 0 |
| adaptive | 49.51 ± 2.73 | 1% | 76% | 27% | 0.200 | 12.32 | 158 | 0 |
| chen_tag | 47.69 ± 2.54 | 0% | 79% | 24% | 0.194 | 8.39 | 156 | 0 |

paired difference vs icm_tag (same tables):
  pushfold_icm                 -10.46 ± 3.52 *
  adaptive                     -8.30 ± 3.56 *
  chen_tag                     -10.12 ± 3.54 *

done
