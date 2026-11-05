# slower host, time limit on: icm_switch vs icm_tag, fresh seeds 441000+ (600 paired tables)

## cell 1: --field custom:f10_chen=2,f10_ 1,f9_float=1

| icm_tag | 41.21 ± 2.66 | 13% | 42% | 78% | 0.151 | 9.24 | 15 | 0 |
| icm_switch | 44.59 ± 2.72 | 17% | 48% | 76% | 0.156 | 8.17 | 14 | 0 |
paired difference vs icm_tag (same tables):
  icm_switch                   +3.38 ± 1.79 *

## cell 2: --field field10 ield field10

| icm_tag | 62.93 ± 2.76 | 31% | 68% | 48% | 0.106 | 10.46 | 9 | 0 |
| icm_switch | 63.45 ± 2.76 | 32% | 70% | 48% | 0.109 | 8.11 | 14 | 0 |
paired difference vs icm_tag (same tables):
  icm_switch                   +0.52 ± 1.48

## cell 3: --field field5 field field5

| icm_tag | 60.71 ± 2.99 | 31% | 65% | 43% | 0.191 | 4.12 | 11 | 0 |
| icm_switch | 60.68 ± 2.97 | 31% | 66% | 45% | 0.184 | 4.04 | 12 | 0 |
paired difference vs icm_tag (same tables):
  icm_switch                   -0.03 ± 1.25

## cell 4: --field field7 field field7

| icm_tag | 22.43 ± 2.15 | 6% | 21% | 93% | 0.186 | 8.95 | 13 | 0 |
| icm_switch | 28.96 ± 2.48 | 10% | 28% | 88% | 0.171 | 12.15 | 16 | 0 |
paired difference vs icm_tag (same tables):
  icm_switch                   +6.53 ± 2.66 *

## cell 5: --preset kit4_sixplus --field  1,f9_float=1

| icm_tag | 43.46 ± 2.59 | 15% | 45% | 79% | 0.127 | 12.39 | 17 | 0 |
| icm_switch | 46.64 ± 2.57 | 18% | 51% | 77% | 0.145 | 4.20 | 16 | 0 |
paired difference vs icm_tag (same tables):
  icm_switch                   +3.18 ± 2.11 *
done
