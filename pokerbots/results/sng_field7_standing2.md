# field 7 (written blind): icm_tag vs field bests (seeds 161000+, 400 paired tables)

  200/2000 tables (34s)
  400/2000 tables (69s)
  600/2000 tables (101s)
  800/2000 tables (134s)
  1000/2000 tables (168s)
  1200/2000 tables (202s)
  1400/2000 tables (236s)
  1600/2000 tables (266s)
  1800/2000 tables (300s)
  2000/2000 tables (334s)
| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 19.93 ± 2.53 | 5% | 16% | 94% | 0.134 | 2.94 | 3 | 0 |
| f2_shark | 37.05 ± 3.34 | 8% | 41% | 78% | 0.071 | 1.35 | 1 | 0 |
| f6_checkraiser | 32.51 ± 2.69 | 4% | 35% | 88% | 0.057 | 4.18 | 3 | 0 |
| f5_nash | 30.54 ± 2.57 | 3% | 33% | 90% | 0.058 | 4.32 | 1 | 0 |
| icm_tag:rfi_lock=0 | 15.87 ± 2.41 | 4% | 11% | 93% | 0.146 | 3.31 | 5 | 0 |

paired difference vs icm_tag (same tables):
  f2_shark                     +17.12 ± 3.97 *
  f6_checkraiser               +12.58 ± 3.33 *
  f5_nash                      +10.60 ± 3.39 *
  icm_tag:rfi_lock=0           -4.06 ± 2.60 *

field archetypes (points/table):
  f7_profiler             38.25 ± 1.64  (n=1535)
  f7_trickster            37.89 ± 1.69  (n=1610)
  f7_bully                36.18 ± 1.50  (n=1590)
  f7_balanced             35.34 ± 1.64  (n=1570)
  f7_hackathon            30.43 ± 1.26  (n=1570)

2000 tables in 334s
