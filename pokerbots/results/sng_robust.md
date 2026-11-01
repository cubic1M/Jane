# icm_tag robustness (fresh seeds 7000+, 300 paired tables per cell)

## field=default payouts=synthetic

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 61.98 ± 3.84 | 15% | 71% | 45% | 0.054 | 8.05 | 10 | 0 |
| pushfold_icm | 51.66 ± 3.63 | 9% | 61% | 59% | 0.166 | 4.23 | 9 | 0 |
| adaptive | 49.49 ± 3.32 | 3% | 61% | 56% | 0.179 | 8.08 | 9 | 0 |
| chen_tag | 48.65 ± 3.10 | 2% | 62% | 56% | 0.172 | 4.27 | 15 | 0 |

paired difference vs icm_tag (same tables):
  pushfold_icm                 -10.32 ± 4.46 *
  adaptive                     -12.49 ± 4.47 *
  chen_tag                     -13.32 ± 4.32 *


## field=default payouts=top3

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 27.29 ± 2.37 | 17% | 66% | 43% | 0.059 | 7.91 | 1 | 0 |
| pushfold_icm | 21.68 ± 2.20 | 12% | 60% | 57% | 0.177 | 2.14 | 2 | 0 |
| adaptive | 20.88 ± 2.00 | 2% | 63% | 51% | 0.193 | 1.57 | 3 | 0 |
| chen_tag | 18.32 ± 1.89 | 1% | 60% | 60% | 0.189 | 7.01 | 31 | 0 |

paired difference vs icm_tag (same tables):
  pushfold_icm                 -5.61 ± 3.00 *
  adaptive                     -6.41 ± 2.90 *
  chen_tag                     -8.96 ± 2.82 *


## field=default payouts=winner

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 45.17 ± 4.64 | 16% | 73% | 39% | 0.054 | 4.76 | 4 | 0 |
| pushfold_icm | 23.56 ± 3.74 | 8% | 58% | 60% | 0.170 | 1.03 | 1 | 0 |
| adaptive | 18.68 ± 3.04 | 3% | 64% | 52% | 0.183 | 2.37 | 4 | 0 |
| chen_tag | 17.12 ± 2.98 | 3% | 67% | 56% | 0.177 | 2.29 | 5 | 0 |

paired difference vs icm_tag (same tables):
  pushfold_icm                 -21.61 ± 5.38 *
  adaptive                     -26.49 ± 4.99 *
  chen_tag                     -28.05 ± 4.95 *


## field=default payouts=linear

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 5.31 ± 0.23 | 16% | 71% | 40% | 0.052 | 8.08 | 3 | 0 |
| pushfold_icm | 4.79 ± 0.23 | 9% | 62% | 58% | 0.170 | 1.59 | 1 | 0 |
| adaptive | 4.66 ± 0.22 | 3% | 62% | 54% | 0.179 | 1.50 | 1 | 0 |
| chen_tag | 4.65 ± 0.20 | 1% | 65% | 58% | 0.170 | 1.15 | 1 | 0 |

paired difference vs icm_tag (same tables):
  pushfold_icm                 -0.52 ± 0.29 *
  adaptive                     -0.65 ± 0.27 *
  chen_tag                     -0.67 ± 0.28 *


## field=strong payouts=synthetic

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 58.11 ± 3.88 | 5% | 69% | 37% | 0.043 | 0.73 | 0 | 0 |
| pushfold_icm | 42.46 ± 3.82 | 3% | 48% | 61% | 0.126 | 0.98 | 0 | 0 |
| adaptive | 40.00 ± 3.05 | 1% | 53% | 55% | 0.145 | 1.02 | 1 | 0 |
| chen_tag | 36.62 ± 2.81 | 0% | 52% | 62% | 0.133 | 1.59 | 1 | 0 |

paired difference vs icm_tag (same tables):
  pushfold_icm                 -15.65 ± 5.22 *
  adaptive                     -18.11 ± 4.50 *
  chen_tag                     -21.49 ± 4.34 *


## field=strong payouts=top3

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 24.95 ± 2.24 | 5% | 64% | 41% | 0.041 | 4.05 | 1 | 0 |
| pushfold_icm | 17.15 ± 2.12 | 2% | 48% | 60% | 0.103 | 0.65 | 0 | 0 |
| adaptive | 13.68 ± 1.78 | 0% | 50% | 59% | 0.142 | 2.35 | 1 | 0 |
| chen_tag | 11.47 ± 1.69 | 1% | 44% | 64% | 0.137 | 0.94 | 0 | 0 |

paired difference vs icm_tag (same tables):
  pushfold_icm                 -7.81 ± 2.89 *
  adaptive                     -11.28 ± 2.59 *
  chen_tag                     -13.48 ± 2.64 *


## field=strong payouts=winner

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 40.53 ± 4.01 | 6% | 69% | 35% | 0.041 | 8.52 | 4 | 0 |
| pushfold_icm | 20.24 ± 3.29 | 4% | 47% | 61% | 0.079 | 0.40 | 0 | 0 |
| adaptive | 10.70 ± 2.25 | 1% | 47% | 63% | 0.139 | 2.01 | 1 | 0 |
| chen_tag | 8.28 ± 1.81 | 1% | 41% | 67% | 0.131 | 1.30 | 2 | 0 |

paired difference vs icm_tag (same tables):
  pushfold_icm                 -20.29 ± 4.74 *
  adaptive                     -29.83 ± 4.34 *
  chen_tag                     -32.25 ± 4.04 *


## field=strong payouts=linear

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 4.94 ± 0.26 | 5% | 69% | 37% | 0.042 | 7.54 | 2 | 0 |
| pushfold_icm | 4.22 ± 0.25 | 4% | 50% | 56% | 0.091 | 0.85 | 0 | 0 |
| adaptive | 3.95 ± 0.22 | 0% | 50% | 58% | 0.141 | 0.65 | 0 | 0 |
| chen_tag | 3.79 ± 0.22 | 0% | 43% | 65% | 0.136 | 3.43 | 2 | 0 |

paired difference vs icm_tag (same tables):
  pushfold_icm                 -0.72 ± 0.33 *
  adaptive                     -0.99 ± 0.31 *
  chen_tag                     -1.15 ± 0.30 *


## field=weak payouts=synthetic

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 64.30 ± 3.66 | 21% | 74% | 49% | 0.056 | 0.66 | 0 | 0 |
| pushfold_icm | 52.21 ± 3.47 | 12% | 61% | 66% | 0.178 | 2.37 | 3 | 0 |
| adaptive | 52.48 ± 3.35 | 5% | 66% | 59% | 0.193 | 6.59 | 4 | 0 |
| chen_tag | 53.02 ± 3.12 | 4% | 69% | 57% | 0.183 | 9.33 | 2 | 0 |

paired difference vs icm_tag (same tables):
  pushfold_icm                 -12.09 ± 4.59 *
  adaptive                     -11.81 ± 4.36 *
  chen_tag                     -11.28 ± 4.43 *


## field=weak payouts=top3

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 25.12 ± 2.37 | 17% | 63% | 56% | 0.057 | 7.59 | 3 | 0 |
| pushfold_icm | 20.37 ± 2.12 | 9% | 59% | 69% | 0.181 | 1.34 | 4 | 0 |
| adaptive | 21.74 ± 1.95 | 6% | 67% | 63% | 0.192 | 3.87 | 7 | 0 |
| chen_tag | 22.95 ± 1.90 | 6% | 71% | 56% | 0.187 | 2.46 | 6 | 0 |

paired difference vs icm_tag (same tables):
  pushfold_icm                 -4.76 ± 2.90 *
  adaptive                     -3.38 ± 2.74 *
  chen_tag                     -2.18 ± 2.70


## field=weak payouts=winner

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 39.26 ± 5.01 | 23% | 69% | 52% | 0.057 | 1.02 | 2 | 0 |
| pushfold_icm | 21.21 ± 3.76 | 10% | 62% | 65% | 0.187 | 2.15 | 1 | 0 |
| adaptive | 21.64 ± 3.77 | 6% | 65% | 59% | 0.194 | 2.56 | 8 | 0 |
| chen_tag | 18.70 ± 3.36 | 5% | 71% | 58% | 0.188 | 1.83 | 4 | 0 |

paired difference vs icm_tag (same tables):
  pushfold_icm                 -18.05 ± 5.57 *
  adaptive                     -17.62 ± 5.74 *
  chen_tag                     -20.55 ± 5.26 *


## field=weak payouts=linear

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 5.35 ± 0.22 | 23% | 72% | 45% | 0.058 | 4.42 | 3 | 0 |
| pushfold_icm | 4.87 ± 0.21 | 12% | 63% | 64% | 0.182 | 2.17 | 2 | 0 |
| adaptive | 4.98 ± 0.21 | 6% | 68% | 53% | 0.193 | 0.89 | 0 | 0 |
| chen_tag | 5.03 ± 0.20 | 6% | 70% | 56% | 0.188 | 2.11 | 5 | 0 |

paired difference vs icm_tag (same tables):
  pushfold_icm                 -0.49 ± 0.27 *
  adaptive                     -0.38 ± 0.27 *
  chen_tag                     -0.33 ± 0.26 *

done
