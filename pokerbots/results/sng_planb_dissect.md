# Plan B field: one feature at a time (seeds 64000+, 400 paired tables)
paired difference vs icm_tag (same tables):
  icm_tag:read_alpha=0         -1.37 ± 2.01
  icm_tag:steal_sym=0          +0.11 ± 1.45
  icm_tag:bluff_bonus=0        -1.83 ± 1.81 *
  icm_tag:icm_call=0           -0.90 ± 1.61
  icm_tag:hu_open_mult=0;hu_range_k=0 +0.26 ± 1.44
  icm_tag:bet_discount=0.6     -1.42 ± 1.92
  icm_tag:threebet_rel=99;threebet_eq=0.62 -0.32 ± 1.59
  icm_tag:read_alpha=0;steal_sym=0;bluff_bonus=0;icm_call=0;hu_open_mult=0;hu_range_k=0;bet_discount=0.6;threebet_rel=99;threebet_eq=0.62;behind_k=0 -2.43 ± 2.37 *
  planb_sd                     +3.47 ± 2.59 *

field archetypes (points/table):
  planb_sd                38.91 ± 0.68  (n=4000)

4000 tables in 422s
done
