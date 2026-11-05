# stricter 52-card hand-over exploration, seeds 371000+ (400 paired tables, baseline icm_switch)

## --field field5

paired difference vs icm_switch (same tables):
  icm_switch:switch_min=30;switch_share=0.3 +0.58 ± 1.31
  icm_switch:switch_min=25;switch_share=0.33 +1.27 ± 1.38
  icm_switch:switch_min=20;switch_share=0.35 +0.47 ± 1.08
  icm_tag                      +1.14 ± 1.37


## --field field3

paired difference vs icm_switch (same tables):
  icm_switch:switch_min=30;switch_share=0.3 +0.32 ± 2.48
  icm_switch:switch_min=25;switch_share=0.33 -0.75 ± 2.56
  icm_switch:switch_min=20;switch_share=0.35 -1.88 ± 2.53
  icm_tag                      -1.53 ± 2.70


## --field default

paired difference vs icm_switch (same tables):
  icm_switch:switch_min=30;switch_share=0.3 -0.18 ± 3.82
  icm_switch:switch_min=25;switch_share=0.33 +1.55 ± 3.88
  icm_switch:switch_min=20;switch_share=0.35 -0.50 ± 3.66
  icm_tag                      +0.52 ± 3.68

## --field field10

paired difference vs icm_switch (same tables):
  icm_switch:switch_min=30;switch_share=0.3 -0.48 ± 1.25
  icm_switch:switch_min=25;switch_share=0.33 -0.18 ± 1.29
  icm_switch:switch_min=20;switch_share=0.35 +0.53 ± 1.26
  icm_tag                      -0.17 ± 1.56


## --field field7

paired difference vs icm_switch (same tables):
  icm_switch:switch_min=30;switch_share=0.3 -2.18 ± 3.54
  icm_switch:switch_min=25;switch_share=0.33 -2.09 ± 3.43
  icm_switch:switch_min=20;switch_share=0.35 +2.26 ± 2.75
  icm_tag                      -3.96 ± 3.32 *


## --field custom:f2_shark=1,f3_exploiter=1,f4_icm=1,f5_adapt=1

paired difference vs icm_switch (same tables):
  icm_switch:switch_min=30;switch_share=0.3 -1.01 ± 2.81
  icm_switch:switch_min=25;switch_share=0.33 +0.79 ± 3.03
  icm_switch:switch_min=20;switch_share=0.35 +0.19 ± 2.13
  icm_tag                      -2.65 ± 3.12


## --field custom:f2_shark=1,f3_exploiter=1,f7_balanced=1,f8_en

paired difference vs icm_switch (same tables):
  icm_switch:switch_min=30;switch_share=0.3 -2.45 ± 2.22 *
  icm_switch:switch_min=25;switch_share=0.33 -2.75 ± 2.37 *
  icm_switch:switch_min=20;switch_share=0.35 -0.90 ± 1.82
  icm_tag                      -2.66 ± 2.21 *


## --field field6

paired difference vs icm_switch (same tables):
  icm_switch:switch_min=30;switch_share=0.3 -2.13 ± 3.31
  icm_switch:switch_min=25;switch_share=0.33 -5.70 ± 3.38 *
  icm_switch:switch_min=20;switch_share=0.35 -4.13 ± 2.65 *
  icm_tag                      -7.80 ± 3.42 *

done
