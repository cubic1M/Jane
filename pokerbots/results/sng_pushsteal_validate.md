# push_steal fresh-seed validation (seeds 68000+, 600 paired tables)

## --preset rehearsal_sixplus --field custom:planb_sd

paired difference vs icm_tag (same tables):
  icm_tag:push_steal=0.5       +5.60 ± 1.37 *
  icm_tag:push_steal=0.3       +3.19 ± 1.32 *

field archetypes (points/table):
  planb_sd                36.90 ± 1.00  (n=1800)

## --field default

paired difference vs icm_tag (same tables):
  icm_tag:push_steal=0.5       +0.25 ± 3.23
  icm_tag:push_steal=0.3       -1.35 ± 3.15

field archetypes (points/table):
  pushfold_icm            42.61 ± 1.76  (n=960)

## --field field2

paired difference vs icm_tag (same tables):
  icm_tag:push_steal=0.5       +0.00 ± 1.53
  icm_tag:push_steal=0.3       -0.06 ± 1.42

field archetypes (points/table):
  f2_bubble               37.32 ± 1.68  (n=1290)

## --field field3

paired difference vs icm_tag (same tables):
  icm_tag:push_steal=0.5       +3.37 ± 2.34 *
  icm_tag:push_steal=0.3       +0.56 ± 2.32

field archetypes (points/table):
  f3_exploiter            54.69 ± 3.56  (n=486)

## --field all3 --payouts top3

paired difference vs icm_tag (same tables):
  icm_tag:push_steal=0.5       -1.07 ± 1.58
  icm_tag:push_steal=0.3       -0.97 ± 1.49

field archetypes (points/table):
  f3_exploiter            22.29 ± 2.90  (n=225)

## --field all3 --payouts winner

paired difference vs icm_tag (same tables):
  icm_tag:push_steal=0.5       -0.68 ± 3.26
  icm_tag:push_steal=0.3       +0.90 ± 3.44

field archetypes (points/table):
  f3_exploiter            32.89 ± 7.05  (n=162)

## --field custom:push=2,maniac=2,station=2,random=1,

paired difference vs icm_tag (same tables):
  icm_tag:push_steal=0.5       +1.01 ± 1.06
  icm_tag:push_steal=0.3       +0.01 ± 0.75

field archetypes (points/table):
  f3_exploiter            57.05 ± 2.83  (n=660)

## --field mirror

paired difference vs icm_tag (same tables):
  icm_tag:push_steal=0.5       +3.13 ± 1.67 *
  icm_tag:push_steal=0.3       +1.49 ± 1.41 *

field archetypes (points/table):
  icm_tag                 43.00 ± 1.52  (n=1785)
done
