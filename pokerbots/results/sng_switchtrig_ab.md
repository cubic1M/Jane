# icm_switch trigger exploration, seeds 311000+ (300 paired tables, baseline icm_switch)

## --field default

paired difference vs icm_switch (same tables):
  icm_switch:rfi_lock_min=15   -2.05 ± 4.73
  icm_switch:rfi_lock_min=12   -0.83 ± 4.65
  icm_switch:rfi_lock=0.27     -0.68 ± 4.51
  icm_switch:rfi_lock_min=15;rfi_lock=0.27 +0.66 ± 4.56


## --field field3

paired difference vs icm_switch (same tables):
  icm_switch:rfi_lock_min=15   -1.61 ± 3.46
  icm_switch:rfi_lock_min=12   -3.10 ± 3.61
  icm_switch:rfi_lock=0.27     -0.94 ± 3.50
  icm_switch:rfi_lock_min=15;rfi_lock=0.27 -0.99 ± 3.45


## --field field5

paired difference vs icm_switch (same tables):
  icm_switch:rfi_lock_min=15   -1.78 ± 1.50 *
  icm_switch:rfi_lock_min=12   -1.42 ± 1.74
  icm_switch:rfi_lock=0.27     -0.17 ± 1.42
  icm_switch:rfi_lock_min=15;rfi_lock=0.27 +0.03 ± 1.95


## --field all3 --payouts winner

paired difference vs icm_switch (same tables):
  icm_switch:rfi_lock_min=15   -3.84 ± 4.72
  icm_switch:rfi_lock_min=12   -2.97 ± 4.71
  icm_switch:rfi_lock=0.27     -4.46 ± 4.93
  icm_switch:rfi_lock_min=15;rfi_lock=0.27 -3.61 ± 4.55


## --field field6

paired difference vs icm_switch (same tables):
  icm_switch:rfi_lock_min=15   +0.46 ± 3.02
  icm_switch:rfi_lock_min=12   +3.62 ± 3.69
  icm_switch:rfi_lock=0.27     +2.97 ± 2.95 *
  icm_switch:rfi_lock_min=15;rfi_lock=0.27 +2.94 ± 4.05


## --field field7

paired difference vs icm_switch (same tables):
  icm_switch:rfi_lock_min=15   +2.37 ± 3.80
  icm_switch:rfi_lock_min=12   +2.31 ± 3.91
  icm_switch:rfi_lock=0.27     -0.12 ± 3.57
  icm_switch:rfi_lock_min=15;rfi_lock=0.27 +1.26 ± 4.00


## --field field9

paired difference vs icm_switch (same tables):
  icm_switch:rfi_lock_min=15   -0.22 ± 1.27
  icm_switch:rfi_lock_min=12   +0.78 ± 1.89
  icm_switch:rfi_lock=0.27     +0.22 ± 1.86
  icm_switch:rfi_lock_min=15;rfi_lock=0.27 +0.37 ± 2.22


## --field custom:f2_shark=1,f3_exploiter=1,f7_balanced=1,f8_en

paired difference vs icm_switch (same tables):
  icm_switch:rfi_lock_min=15   +1.74 ± 1.93
  icm_switch:rfi_lock_min=12   +1.90 ± 2.04
  icm_switch:rfi_lock=0.27     +0.71 ± 1.84
  icm_switch:rfi_lock_min=15;rfi_lock=0.27 +2.61 ± 2.60 *


## --field custom:f2_shark=1,f3_exploiter=1,f4_icm=1,f5_adapt=1

paired difference vs icm_switch (same tables):
  icm_switch:rfi_lock_min=15   +1.69 ± 2.39
  icm_switch:rfi_lock_min=12   +3.50 ± 3.01 *
  icm_switch:rfi_lock=0.27     +2.07 ± 2.45
  icm_switch:rfi_lock_min=15;rfi_lock=0.27 +2.93 ± 3.34


## --field mirror

paired difference vs icm_switch (same tables):
  icm_switch:rfi_lock_min=15   +0.21 ± 1.57
  icm_switch:rfi_lock_min=12   -0.26 ± 1.65
  icm_switch:rfi_lock=0.27     +1.42 ± 2.72
  icm_switch:rfi_lock_min=15;rfi_lock=0.27 +1.37 ± 3.09

done
