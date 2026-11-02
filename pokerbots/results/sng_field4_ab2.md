# field 4 part 2: steal widening (seeds 74000+)

## --field field4 --tables 400

paired difference vs icm_tag (same tables):
  icm_tag:push_steal=0         +3.61 ± 2.86 *
  icm_tag:steal_bonus=0.3      +4.65 ± 3.21 *
  icm_tag:steal_bonus=0        +5.28 ± 3.32 *
  icm_tag:steal_floor=0.7      +1.23 ± 3.04
  icm_tag:steal_floor=0.7;push_steal=0 +2.56 ± 3.03

field archetypes (points/table):
  f4_icm                  40.97 ± 1.41  (n=1776)

## --field all3 --tables 300

paired difference vs icm_tag (same tables):
  icm_tag:push_steal=0         +0.48 ± 4.56
  icm_tag:steal_bonus=0.3      -2.04 ± 4.52
  icm_tag:steal_bonus=0        -9.48 ± 4.54 *
  icm_tag:steal_floor=0.7      -3.76 ± 4.53
  icm_tag:steal_floor=0.7;push_steal=0 -3.67 ± 4.66

field archetypes (points/table):
  f3_exploiter            47.01 ± 5.79  (n=138)
done
