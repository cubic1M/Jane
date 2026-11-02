# hu_risk / cap_fade exploration (seeds 52000+, 600 paired tables)

## --field all3 --payouts top3

paired difference vs icm_tag (same tables):
  icm_tag:hu_risk=0            +0.28 ± 1.45
  icm_tag:hu_risk=0.5          +1.05 ± 1.52
  icm_tag:cap_fade=25          +0.32 ± 1.47
  icm_tag:cap_fade=50          +0.02 ± 1.38
  icm_tag:hu_risk=0;cap_fade=50 -0.30 ± 1.51

field archetypes (points/table):
  f3_exploiter            23.85 ± 1.89  (n=462)

## --field field3

paired difference vs icm_tag (same tables):
  icm_tag:hu_risk=0            +1.10 ± 2.08
  icm_tag:hu_risk=0.5          -0.19 ± 2.23
  icm_tag:cap_fade=25          +0.79 ± 2.00
  icm_tag:cap_fade=50          +0.28 ± 2.11
  icm_tag:hu_risk=0;cap_fade=50 -0.55 ± 2.13

field archetypes (points/table):
  f3_exploiter            55.08 ± 2.56  (n=972)

## --field field2

paired difference vs icm_tag (same tables):
  icm_tag:hu_risk=0            -0.11 ± 0.49
  icm_tag:hu_risk=0.5          +0.19 ± 0.45
  icm_tag:cap_fade=25          +0.06 ± 0.42
  icm_tag:cap_fade=50          +0.07 ± 0.57
  icm_tag:hu_risk=0;cap_fade=50 +0.28 ± 0.48

field archetypes (points/table):
  f2_shark                38.41 ± 1.25  (n=2628)

## --field custom:push=2,maniac=2,station=2

paired difference vs icm_tag (same tables):
  icm_tag:hu_risk=0            +0.37 ± 0.46
  icm_tag:hu_risk=0.5          -0.14 ± 0.41
  icm_tag:cap_fade=25          -0.13 ± 0.38
  icm_tag:cap_fade=50          -0.01 ± 0.26
  icm_tag:hu_risk=0;cap_fade=50 +0.12 ± 0.42

field archetypes (points/table):
  f3_exploiter            60.11 ± 1.92  (n=1272)
done
