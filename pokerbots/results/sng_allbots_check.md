# icm_switch + strong-room option vs icm_tag in an all-55-bot room (ROOM + unseen), seeds 661000+ (600 paired tables)

## cell 1: all-bots 

| icm_tag | 42.60 ± 2.72 | 15% | 46% | 75% | 0.164 | 6.98 | 49 | 0 |
| icm_switch | 43.68 ± 2.78 | 17% | 47% | 74% | 0.169 | 5.72 | 39 | 0 |
| icm_switch:start=b;back_share=0.22;switch_min=15 | 46.90 ± 2.75 | 18% | 51% | 71% | 0.170 | 12.38 | 72 | 0 |

paired difference vs icm_tag (same tables):
  icm_switch                   +1.07 ± 2.09
  icm_switch:start=b;back_share=0.22;switch_min=15 +4.30 ± 3.43 *

field archetypes (points/table):

## cell 2: all-bots --preset kit4_sixplus

| icm_tag | 43.33 ± 2.66 | 16% | 47% | 78% | 0.133 | 6.17 | 31 | 0 |
| icm_switch | 46.01 ± 2.64 | 18% | 51% | 78% | 0.149 | 8.24 | 26 | 0 |
| icm_switch:start=b;back_share=0.22;switch_min=15 | 52.12 ± 2.74 | 24% | 57% | 71% | 0.147 | 4.44 | 46 | 0 |

paired difference vs icm_tag (same tables):
  icm_switch                   +2.68 ± 2.28 *
  icm_switch:start=b;back_share=0.22;switch_min=15 +8.79 ± 3.50 *

field archetypes (points/table):
done

## strong-room option vs icm_switch directly (same seeds as cells 1-2)
### cell 1 
