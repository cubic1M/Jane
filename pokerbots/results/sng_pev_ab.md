# pev exploration (seeds 44000+, 500 paired tables)

## --field field2

paired difference vs icm_tag (same tables):
  icm_tag:pev=1;pev_risk=0     -0.20 ± 2.01
  icm_tag:pev=1;pev_risk=0.25  -0.03 ± 1.86
  icm_tag:pev=1;pev_risk=0.5   +1.33 ± 1.94
  icm_tag:pev=1;pev_risk=0;pev_bb=11 -0.40 ± 1.85
  icm_tag:pev=1;pev_risk=0.25;pev_loose=1.3 -0.17 ± 2.01


## --field all3 --payouts top3

paired difference vs icm_tag (same tables):
  icm_tag:pev=1;pev_risk=0     +2.57 ± 1.84 *
  icm_tag:pev=1;pev_risk=0.25  +1.50 ± 1.84
  icm_tag:pev=1;pev_risk=0.5   +0.08 ± 1.67
  icm_tag:pev=1;pev_risk=0;pev_bb=11 +1.10 ± 1.80
  icm_tag:pev=1;pev_risk=0.25;pev_loose=1.3 +0.71 ± 1.85


## --field default

paired difference vs icm_tag (same tables):
  icm_tag:pev=1;pev_risk=0     +0.27 ± 3.04
  icm_tag:pev=1;pev_risk=0.25  +0.94 ± 3.37
  icm_tag:pev=1;pev_risk=0.5   +0.12 ± 3.25
  icm_tag:pev=1;pev_risk=0;pev_bb=11 +2.62 ± 3.15
  icm_tag:pev=1;pev_risk=0.25;pev_loose=1.3 +0.58 ± 3.38

done
