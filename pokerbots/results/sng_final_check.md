# current icm_tag vs each field's best (fresh seeds 21000+, 300 paired tables, 2 workers)

## --field default

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 72.25 ± 3.79 | 31% | 77% | 32% | 0.060 | 7.87 | 3 | 0 |
| pushfold_icm | 49.31 ± 3.54 | 6% | 57% | 61% | 0.175 | 1.54 | 3 | 0 |
| adaptive | 48.37 ± 3.33 | 2% | 59% | 53% | 0.187 | 2.47 | 4 | 0 |
| chen_tag | 49.74 ± 3.13 | 2% | 64% | 51% | 0.186 | 3.41 | 3 | 0 |

paired difference vs icm_tag (same tables):
  pushfold_icm                 -22.94 ± 4.80 *
  adaptive                     -23.88 ± 5.20 *

## --field strong

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 71.87 ± 3.51 | 15% | 81% | 22% | 0.048 | 8.45 | 1 | 0 |
| pushfold_icm | 44.97 ± 3.66 | 2% | 52% | 56% | 0.130 | 5.12 | 2 | 0 |
| adaptive | 37.63 ± 2.95 | 0% | 48% | 62% | 0.151 | 1.74 | 1 | 0 |
| chen_tag | 33.83 ± 2.75 | 0% | 42% | 67% | 0.142 | 3.56 | 1 | 0 |

paired difference vs icm_tag (same tables):
  pushfold_icm                 -26.89 ± 4.73 *
  adaptive                     -34.24 ± 4.33 *

## --field mirror

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 40.49 ± 3.88 | 2% | 49% | 56% | 0.037 | 2.13 | 1 | 0 |
| pushfold_icm | 35.20 ± 3.48 | 1% | 43% | 64% | 0.045 | 0.57 | 0 | 0 |
| adaptive | 22.97 ± 2.07 | 0% | 21% | 89% | 0.152 | 0.78 | 0 | 0 |
| chen_tag | 20.42 ± 1.85 | 0% | 18% | 93% | 0.146 | 0.45 | 0 | 0 |

paired difference vs icm_tag (same tables):
  pushfold_icm                 -5.30 ± 5.11 *
  adaptive                     -17.53 ± 4.13 *

## --field field2

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 43.90 ± 3.44 | 4% | 49% | 70% | 0.060 | 2.43 | 3 | 0 |
| f2_shark | 36.51 ± 3.42 | 10% | 42% | 87% | 0.068 | 2.60 | 4 | 0 |
| f2_nash | 35.50 ± 3.26 | 6% | 40% | 87% | 0.061 | 2.13 | 2 | 0 |
| f2_bubble | 38.45 ± 3.44 | 10% | 41% | 84% | 0.064 | 3.55 | 5 | 0 |

paired difference vs icm_tag (same tables):
  f2_shark                     -7.39 ± 4.36 *
  f2_nash                      -8.41 ± 4.70 *

## --field field3

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 66.25 ± 3.83 | 14% | 74% | 38% | 0.059 | 2.13 | 4 | 0 |
| f3_exploiter | 56.66 ± 4.40 | 29% | 60% | 54% | 0.206 | 3.25 | 5 | 0 |
| f3_quant_icm | 49.30 ± 3.60 | 12% | 57% | 63% | 0.186 | 3.85 | 5 | 0 |
| f3_ladder_pro | 45.12 ± 4.39 | 23% | 45% | 66% | 0.342 | 2.65 | 11 | 0 |

paired difference vs icm_tag (same tables):
  f3_exploiter                 -9.59 ± 5.49 *
  f3_quant_icm                 -16.95 ± 5.00 *

## --field all3 --payouts top3

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 25.32 ± 2.26 | 12% | 66% | 50% | 0.062 | 5.18 | 3 | 0 |
| f3_exploiter | 20.85 ± 2.44 | 22% | 52% | 64% | 0.251 | 2.99 | 11 | 0 |
| f2_shark | 14.92 ± 2.14 | 8% | 42% | 76% | 0.076 | 1.61 | 1 | 0 |
| pushfold_icm | 15.27 ± 1.95 | 2% | 48% | 76% | 0.170 | 2.10 | 3 | 0 |

paired difference vs icm_tag (same tables):
  f3_exploiter                 -4.47 ± 3.05 *
  f2_shark                     -10.40 ± 3.07 *
done
