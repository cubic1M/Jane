# Heads-up and 3-handed (seeds 30000+, 600 paired tables per cell; payouts = top N of synthetic)

## players=2 field=all3

  2880/3600 tables (33s)
  3240/3600 tables (37s)
  3600/3600 tables (40s)
| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 88.36 ± 1.32 | 67% | 100% | 33% | 0.046 | 4.04 | 4 | 0 |
paired difference vs icm_tag (same tables):
  pushfold_icm                 -3.82 ± 1.54 *
  f3_exploiter                 +4.23 ± 1.45 *
  f2_shark                     +0.56 ± 1.52
  f2_nash                      -1.31 ± 1.60
  adaptive                     -12.26 ± 1.52 *

## players=2 field=default

  2880/3600 tables (41s)
  3240/3600 tables (47s)
  3600/3600 tables (52s)
| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 93.12 ± 1.11 | 80% | 100% | 20% | 0.051 | 12.71 | 5 | 0 |
paired difference vs icm_tag (same tables):
  pushfold_icm                 -4.38 ± 1.43 *
  f3_exploiter                 +1.52 ± 1.30 *
  f2_shark                     -0.88 ± 1.36
  f2_nash                      -2.39 ± 1.51 *
  adaptive                     -9.50 ± 1.46 *

## players=2 field=field3

  2880/3600 tables (34s)
  3240/3600 tables (37s)
  3600/3600 tables (40s)
| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 93.59 ± 1.08 | 82% | 100% | 18% | 0.047 | 4.10 | 4 | 0 |
paired difference vs icm_tag (same tables):
  pushfold_icm                 -6.89 ± 1.49 *
  f3_exploiter                 +0.75 ± 1.28
  f2_shark                     -3.91 ± 1.41 *
  f2_nash                      -6.07 ± 1.51 *
  adaptive                     -19.06 ± 1.44 *

## players=3 field=all3

  2880/3600 tables (64s)
  3240/3600 tables (71s)
  3600/3600 tables (79s)
| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 81.42 ± 1.65 | 52% | 100% | 45% | 0.051 | 4.07 | 5 | 0 |
paired difference vs icm_tag (same tables):
  pushfold_icm                 -8.95 ± 2.17 *
  f3_exploiter                 +1.74 ± 2.07
  f2_shark                     -3.19 ± 2.27 *
  f2_nash                      -6.44 ± 2.18 *
  adaptive                     -15.85 ± 1.91 *

## players=3 field=default

  2880/3600 tables (100s)
  3240/3600 tables (111s)
  3600/3600 tables (123s)
| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 89.33 ± 1.47 | 74% | 100% | 26% | 0.054 | 3.36 | 3 | 0 |
paired difference vs icm_tag (same tables):
  pushfold_icm                 -6.39 ± 2.12 *
  f3_exploiter                 +0.73 ± 1.91
  f2_shark                     -3.08 ± 2.07 *
  f2_nash                      -4.83 ± 2.12 *
  adaptive                     -13.73 ± 1.86 *

## players=3 field=field3

  2880/3600 tables (63s)
  3240/3600 tables (71s)
  3600/3600 tables (78s)
| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 87.85 ± 1.45 | 65% | 100% | 28% | 0.049 | 3.13 | 2 | 0 |
paired difference vs icm_tag (same tables):
  pushfold_icm                 -11.62 ± 1.96 *
  f3_exploiter                 +0.48 ± 1.75
  f2_shark                     -8.86 ± 2.09 *
  f2_nash                      -10.74 ± 2.03 *
  adaptive                     -23.25 ± 1.72 *
done
