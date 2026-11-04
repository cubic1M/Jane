# Strength on split-pot games (engine/showdown.py; seeds 141000+, 200 paired tables, default field, --no-enforce)

## holdem_hilo8

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_any | 69.41 ± 4.65 | 38% | 74% | 42% | 0.089 | 12.08 | 29 | 0 |
| icm_tag | 67.87 ± 4.71 | 34% | 74% | 45% | 0.093 | 12.08 | 34 | 0 |
| f3_exploiter | 54.43 ± 5.67 | 34% | 55% | 55% | 0.216 | 16.07 | 37 | 0 |
| f2_shark | 47.78 ± 4.91 | 6% | 50% | 58% | 0.086 | 12.39 | 35 | 0 |
| f5_adapt | 45.61 ± 5.09 | 16% | 48% | 62% | 0.081 | 8.96 | 39 | 0 |
| f6_checkraiser | 55.21 ± 4.85 | 18% | 60% | 55% | 0.078 | 12.08 | 32 | 0 |
paired difference vs icm_any (same tables):
  icm_tag                      -1.54 ± 6.19
  f3_exploiter                 -14.98 ± 7.04 *
  f2_shark                     -21.63 ± 6.69 *
  f5_adapt                     -23.80 ± 6.54 *
  f6_checkraiser               -14.20 ± 6.31 *

## omaha_hilo8

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_any | 56.53 ± 4.33 | 12% | 67% | 60% | 0.104 | 24.16 | 142 | 0 |
| icm_tag | 57.91 ± 4.98 | 25% | 62% | 55% | 0.123 | 12.11 | 101 | 0 |
| f3_exploiter | 34.25 ± 5.83 | 28% | 31% | 72% | 0.190 | 38.63 | 107 | 0 |
| f2_shark | 52.18 ± 4.93 | 10% | 56% | 63% | 0.174 | 48.23 | 162 | 0 |
| f5_adapt | 40.16 ± 4.93 | 13% | 40% | 72% | 0.103 | 12.12 | 70 | 0 |
| f6_checkraiser | 31.88 ± 4.65 | 10% | 31% | 82% | 0.137 | 8.25 | 63 | 0 |
paired difference vs icm_any (same tables):
  icm_tag                      +1.38 ± 6.11
  f3_exploiter                 -22.28 ± 7.08 *
  f2_shark                     -4.35 ± 6.11
  f5_adapt                     -16.37 ± 6.24 *
  f6_checkraiser               -24.65 ± 5.72 *

## double_board

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_any | 56.85 ± 4.51 | 14% | 63% | 57% | 0.092 | 3.12 | 2 | 0 |
| icm_tag | 48.85 ± 5.20 | 24% | 49% | 66% | 0.102 | 3.97 | 3 | 0 |
| f3_exploiter | 46.67 ± 5.37 | 26% | 43% | 66% | 0.222 | 1.62 | 2 | 0 |
| f2_shark | 44.60 ± 4.83 | 6% | 45% | 65% | 0.092 | 1.97 | 1 | 0 |
| f5_adapt | 52.77 ± 4.91 | 18% | 57% | 58% | 0.080 | 1.66 | 2 | 0 |
| f6_checkraiser | 52.80 ± 4.72 | 16% | 60% | 60% | 0.082 | 4.43 | 3 | 0 |
paired difference vs icm_any (same tables):
  icm_tag                      -8.00 ± 6.33 *
  f3_exploiter                 -10.18 ± 6.56 *
  f2_shark                     -12.25 ± 6.52 *
  f5_adapt                     -4.08 ± 6.63
  f6_checkraiser               -4.05 ± 6.64
done
