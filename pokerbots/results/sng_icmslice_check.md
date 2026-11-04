# icm_slice=1 vs full refresh (icm_switch), seeds 301000+ (400 paired tables)

## --field field6

paired difference vs icm_switch (same tables):
  icm_switch:icm_slice=1       +0.05 ± 2.00
  icm_tag                      -4.93 ± 3.39 *


## --field field7

paired difference vs icm_switch (same tables):
  icm_switch:icm_slice=1       -0.33 ± 2.72
  icm_tag                      -3.74 ± 3.15 *


## --field field9

paired difference vs icm_switch (same tables):
  icm_switch:icm_slice=1       -1.55 ± 1.36 *
  icm_tag                      -2.37 ± 1.80 *


## --field custom:f2_shark=1,f3_exploiter=1,f7_balanced=1,f8_en

paired difference vs icm_switch (same tables):
  icm_switch:icm_slice=1       -0.07 ± 1.34
  icm_tag                      -1.64 ± 2.16


## --field custom:f2_shark=1,f3_exploiter=1,f4_icm=1,f5_adapt=1

paired difference vs icm_switch (same tables):
  icm_switch:icm_slice=1       -1.84 ± 1.66 *
  icm_tag                      -4.72 ± 2.92 *


## --field mirror

paired difference vs icm_switch (same tables):
  icm_switch:icm_slice=1       +0.33 ± 1.63
  icm_tag                      -0.76 ± 2.60

done
