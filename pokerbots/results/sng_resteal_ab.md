# resteal / pev (corrected range mapping) exploration (seeds 48000+, 500 paired tables)

## --field field2

paired difference vs icm_tag (same tables):
  icm_tag:resteal=1;resteal_risk=0.25 +1.46 ± 1.23 *
  icm_tag:resteal=1;resteal_risk=0.5 +1.54 ± 1.13 *
  icm_tag:pev=1;pev_risk=0.25  +2.12 ± 2.29
  icm_tag:pev=1;pev_risk=0.5   +3.15 ± 2.31 *
  icm_tag:resteal=1;resteal_risk=0.25;pev=1;pev_risk=0.25 +2.93 ± 2.42 *


## --field all3 --payouts top3

paired difference vs icm_tag (same tables):
  icm_tag:resteal=1;resteal_risk=0.25 -1.45 ± 1.61
  icm_tag:resteal=1;resteal_risk=0.5 -0.19 ± 1.61
  icm_tag:pev=1;pev_risk=0.25  -1.41 ± 1.74
  icm_tag:pev=1;pev_risk=0.5   -0.77 ± 1.77
  icm_tag:resteal=1;resteal_risk=0.25;pev=1;pev_risk=0.25 -0.99 ± 1.81


## --field default

paired difference vs icm_tag (same tables):
  icm_tag:resteal=1;resteal_risk=0.25 +0.65 ± 3.05
  icm_tag:resteal=1;resteal_risk=0.5 -0.08 ± 3.31
  icm_tag:pev=1;pev_risk=0.25  +0.92 ± 3.40
  icm_tag:pev=1;pev_risk=0.5   -1.43 ± 3.44
  icm_tag:resteal=1;resteal_risk=0.25;pev=1;pev_risk=0.25 +1.65 ± 3.25

done
