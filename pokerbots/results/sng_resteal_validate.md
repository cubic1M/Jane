# resteal / pev fresh-seed validation (seeds 49000+, 600 paired tables)

## --field field2

paired difference vs icm_tag (same tables):
  icm_tag:resteal=1;resteal_risk=0.5 +0.53 ± 0.97
  icm_tag:pev=1;pev_risk=0.5   +0.72 ± 1.95
  icm_tag:resteal=1;resteal_risk=0.5;pev=1;pev_risk=0.5 +1.28 ± 2.05


## --field field3

paired difference vs icm_tag (same tables):
  icm_tag:resteal=1;resteal_risk=0.5 -2.02 ± 2.30
  icm_tag:pev=1;pev_risk=0.5   -0.46 ± 2.47
  icm_tag:resteal=1;resteal_risk=0.5;pev=1;pev_risk=0.5 -2.18 ± 2.58


## --field default

paired difference vs icm_tag (same tables):
  icm_tag:resteal=1;resteal_risk=0.5 +0.02 ± 2.91
  icm_tag:pev=1;pev_risk=0.5   -0.83 ± 2.91
  icm_tag:resteal=1;resteal_risk=0.5;pev=1;pev_risk=0.5 +0.65 ± 2.90


## --field mirror

paired difference vs icm_tag (same tables):
  icm_tag:resteal=1;resteal_risk=0.5 +5.19 ± 1.77 *
  icm_tag:pev=1;pev_risk=0.5   -0.00 ± 1.96
  icm_tag:resteal=1;resteal_risk=0.5;pev=1;pev_risk=0.5 +5.10 ± 2.30 *


## --field all3 --payouts top3

paired difference vs icm_tag (same tables):
  icm_tag:resteal=1;resteal_risk=0.5 -0.13 ± 1.47
  icm_tag:pev=1;pev_risk=0.5   +0.62 ± 1.62
  icm_tag:resteal=1;resteal_risk=0.5;pev=1;pev_risk=0.5 +0.92 ± 1.69


## --field custom:push=2,maniac=2,station=2

paired difference vs icm_tag (same tables):
  icm_tag:resteal=1;resteal_risk=0.5 +0.02 ± 1.07
  icm_tag:pev=1;pev_risk=0.5   +0.40 ± 1.28
  icm_tag:resteal=1;resteal_risk=0.5;pev=1;pev_risk=0.5 +0.30 ± 1.49

done
