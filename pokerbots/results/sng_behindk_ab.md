# behind_k exploration (seeds 61000+, 500 paired tables)

## --preset rehearsal_sixplus --field custom:planb_sd

paired difference vs icm_tag (same tables):
  icm_tag:behind_k=0           +3.25 ± 1.76 *
  icm_tag:behind_k=0.2         +1.51 ± 1.58
  icm_tag:behind_k=0.4         +0.21 ± 1.36

field archetypes (points/table):
  planb_sd                36.35 ± 0.95  (n=2000)

## --field all3 --payouts top3

paired difference vs icm_tag (same tables):
  icm_tag:behind_k=0           +0.02 ± 1.63
  icm_tag:behind_k=0.2         +0.60 ± 1.70
  icm_tag:behind_k=0.4         +0.51 ± 1.61

field archetypes (points/table):
  f3_exploiter            24.06 ± 2.91  (n=220)

## --field field3

paired difference vs icm_tag (same tables):
  icm_tag:behind_k=0           +1.16 ± 2.27
  icm_tag:behind_k=0.2         -0.12 ± 2.38
  icm_tag:behind_k=0.4         -2.85 ± 2.61 *

field archetypes (points/table):
  f3_exploiter            57.50 ± 3.30  (n=544)

## --field field2

paired difference vs icm_tag (same tables):
  icm_tag:behind_k=0           -0.72 ± 1.62
  icm_tag:behind_k=0.2         -0.69 ± 1.29
  icm_tag:behind_k=0.4         -0.43 ± 1.00

field archetypes (points/table):
  f2_bubble               38.89 ± 1.62  (n=1396)

## --field custom:push=2,maniac=2,station=2,random=1,

paired difference vs icm_tag (same tables):
  icm_tag:behind_k=0           -1.06 ± 1.28
  icm_tag:behind_k=0.2         -0.44 ± 1.04
  icm_tag:behind_k=0.4         -0.51 ± 0.81

field archetypes (points/table):
  f3_exploiter            60.82 ± 2.83  (n=688)

## --field mirror

paired difference vs icm_tag (same tables):
  icm_tag:behind_k=0           +3.90 ± 2.75 *
  icm_tag:behind_k=0.2         +1.97 ± 2.38
  icm_tag:behind_k=0.4         +0.84 ± 1.71

field archetypes (points/table):
  icm_tag                 42.49 ± 1.46  (n=1944)
done
