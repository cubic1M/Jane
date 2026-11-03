# Strength on unseen card rules WITH any-variant tables (seeds 119000+, 200 paired tables, default field, --no-enforce)

## c_discard3

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_any | 72.30 ± 4.19 | 28% | 80% | 32% | 0.080 | 8.46 | 138 | 0 |
| icm_tag | 70.90 ± 4.67 | 38% | 78% | 40% | 0.099 | 16.12 | 129 | 0 |
| f3_exploiter | 50.22 ± 6.40 | 45% | 48% | 55% | 0.263 | 13.51 | 186 | 0 |
| f2_shark | 49.89 ± 5.62 | 18% | 53% | 58% | 0.099 | 12.11 | 133 | 0 |
| f5_adapt | 48.22 ± 5.25 | 16% | 52% | 60% | 0.088 | 12.11 | 92 | 0 |
| f6_checkraiser | 42.17 ± 5.05 | 10% | 46% | 66% | 0.086 | 12.13 | 101 | 0 |
paired difference vs icm_any (same tables):
  icm_tag                      -1.39 ± 4.73
  f3_exploiter                 -22.08 ± 7.56 *
  f2_shark                     -22.41 ± 7.46 *
  f5_adapt                     -24.08 ± 6.52 *
  f6_checkraiser               -30.12 ± 6.48 *

## i_double_discard

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_any | 67.34 ± 4.34 | 23% | 77% | 42% | 0.083 | 5.16 | 5 | 0 |
| icm_tag | 67.07 ± 4.73 | 34% | 74% | 44% | 0.100 | 5.26 | 4 | 0 |
| f3_exploiter | 25.86 ± 5.39 | 20% | 24% | 80% | 0.232 | 4.15 | 8 | 0 |
| f2_shark | 37.49 ± 5.60 | 14% | 38% | 69% | 0.093 | 2.92 | 7 | 0 |
| f5_adapt | 44.92 ± 5.24 | 18% | 46% | 68% | 0.084 | 5.02 | 4 | 0 |
| f6_checkraiser | 35.54 ± 5.50 | 21% | 36% | 74% | 0.193 | 6.08 | 7 | 0 |
paired difference vs icm_any (same tables):
  icm_tag                      -0.28 ± 5.50
  f3_exploiter                 -41.48 ± 7.04 *
  f2_shark                     -29.85 ± 7.11 *
  f5_adapt                     -22.42 ± 6.73 *
  f6_checkraiser               -31.80 ± 6.58 *

## k_irish

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_any | 74.71 ± 4.00 | 26% | 83% | 26% | 0.081 | 2.42 | 4 | 0 |
| icm_tag | 73.49 ± 4.24 | 36% | 82% | 35% | 0.085 | 1.87 | 3 | 0 |
| f3_exploiter | 39.87 ± 6.10 | 32% | 38% | 67% | 0.247 | 4.37 | 4 | 0 |
| f2_shark | 40.18 ± 5.54 | 10% | 40% | 66% | 0.094 | 0.86 | 0 | 0 |
| f5_adapt | 47.55 ± 4.87 | 6% | 52% | 58% | 0.084 | 1.71 | 2 | 0 |
| f6_checkraiser | 47.05 ± 5.78 | 18% | 48% | 56% | 0.082 | 3.23 | 2 | 0 |
paired difference vs icm_any (same tables):
  icm_tag                      -1.22 ± 4.80
  f3_exploiter                 -34.84 ± 7.16 *
  f2_shark                     -34.54 ± 6.53 *
  f5_adapt                     -27.17 ± 5.94 *
  f6_checkraiser               -27.66 ± 6.83 *

## n_plo4

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_any | 59.53 ± 4.41 | 17% | 68% | 55% | 0.098 | 4.08 | 4 | 0 |
| icm_tag | 68.18 ± 4.39 | 32% | 76% | 44% | 0.114 | 2.27 | 4 | 0 |
| f3_exploiter | 33.91 ± 5.55 | 24% | 30% | 76% | 0.176 | 3.11 | 6 | 0 |
| f2_shark | 58.67 ± 4.80 | 16% | 66% | 56% | 0.158 | 27.33 | 7 | 0 |
| f5_adapt | 42.73 ± 4.82 | 10% | 44% | 70% | 0.094 | 10.24 | 1 | 0 |
| f6_checkraiser | 30.86 ± 4.63 | 12% | 27% | 84% | 0.120 | 7.87 | 3 | 0 |
paired difference vs icm_any (same tables):
  icm_tag                      +8.66 ± 5.65 *
  f3_exploiter                 -25.61 ± 7.00 *
  f2_shark                     -0.85 ± 5.93
  f5_adapt                     -16.79 ± 6.27 *
  f6_checkraiser               -28.67 ± 6.25 *
done
