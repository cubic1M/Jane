# push_steal exploration (seeds 66000+, 500 paired tables)

## --preset rehearsal_sixplus --field custom:planb_sd

paired difference vs icm_tag (same tables):
  icm_tag:push_steal=0.5       +5.32 ± 1.91 *
  icm_tag:push_steal=1         +5.12 ± 1.91 *

field archetypes (points/table):
  planb_sd                37.69 ± 1.09  (n=1500)

## --field all3 --payouts top3

paired difference vs icm_tag (same tables):
  icm_tag:push_steal=0.5       +2.18 ± 1.91 *
  icm_tag:push_steal=1         +1.86 ± 1.91

field archetypes (points/table):
  f3_exploiter            26.28 ± 3.35  (n=168)

## --field field3

paired difference vs icm_tag (same tables):
  icm_tag:push_steal=0.5       +1.89 ± 2.71
  icm_tag:push_steal=1         +2.13 ± 2.60

field archetypes (points/table):
  f3_exploiter            57.33 ± 3.74  (n=393)

## --field field2

paired difference vs icm_tag (same tables):
  icm_tag:push_steal=0.5       -0.91 ± 2.48
  icm_tag:push_steal=1         -3.46 ± 2.65 *

field archetypes (points/table):
  f2_shark                37.47 ± 1.99  (n=1095)

## --field custom:push=2,maniac=2,station=2,random=1,

paired difference vs icm_tag (same tables):
  icm_tag:push_steal=0.5       +0.36 ± 2.08
  icm_tag:push_steal=1         -0.11 ± 2.10

field archetypes (points/table):
  f3_exploiter            54.70 ± 3.04  (n=543)

## --field mirror

paired difference vs icm_tag (same tables):
  icm_tag:push_steal=0.5       +3.61 ± 2.27 *
  icm_tag:push_steal=1         +2.75 ± 2.51 *

field archetypes (points/table):
  icm_tag                 42.09 ± 1.61  (n=1473)
done
