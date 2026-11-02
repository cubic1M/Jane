# behind_k fresh-seed validation (seeds 62000+, 600 paired tables)

## --preset rehearsal_sixplus --field custom:planb_sd

paired difference vs icm_tag (same tables):
  icm_tag:behind_k=0           +2.88 ± 1.52 *
  icm_tag:behind_k=0.2         +1.22 ± 1.21 *

field archetypes (points/table):
  planb_sd                38.32 ± 1.00  (n=1800)

## --field default

paired difference vs icm_tag (same tables):
  icm_tag:behind_k=0           -2.94 ± 3.03
  icm_tag:behind_k=0.2         -0.13 ± 2.94

field archetypes (points/table):
  pushfold_icm            42.95 ± 1.78  (n=948)

## --field field2

paired difference vs icm_tag (same tables):
  icm_tag:behind_k=0           +0.89 ± 1.55
  icm_tag:behind_k=0.2         +0.07 ± 1.30

field archetypes (points/table):
  f2_shark                38.60 ± 1.77  (n=1353)

## --field field3

paired difference vs icm_tag (same tables):
  icm_tag:behind_k=0           +0.76 ± 2.43
  icm_tag:behind_k=0.2         -0.22 ± 2.22

field archetypes (points/table):
  f3_exploiter            60.42 ± 3.61  (n=453)

## --field all3 --payouts top3

paired difference vs icm_tag (same tables):
  icm_tag:behind_k=0           -0.00 ± 1.59
  icm_tag:behind_k=0.2         +0.45 ± 1.48

field archetypes (points/table):
  f3_exploiter            24.91 ± 3.19  (n=174)

## --field all3 --payouts winner

paired difference vs icm_tag (same tables):
  icm_tag:behind_k=0           +1.65 ± 3.40
  icm_tag:behind_k=0.2         +1.21 ± 3.35

field archetypes (points/table):
  f3_exploiter            35.24 ± 6.73  (n=186)

## --field custom:push=2,maniac=2,station=2,random=1,

paired difference vs icm_tag (same tables):
  icm_tag:behind_k=0           -0.71 ± 1.18
  icm_tag:behind_k=0.2         +0.36 ± 0.83

field archetypes (points/table):
  f3_exploiter            53.05 ± 2.76  (n=687)

## --field mirror

paired difference vs icm_tag (same tables):
  icm_tag:behind_k=0           +3.35 ± 2.42 *
  icm_tag:behind_k=0.2         +2.52 ± 2.10 *

field archetypes (points/table):
  icm_tag                 43.67 ± 1.53  (n=1758)
done
