#!/bin/bash
# Do tonight's adopted switches (behind_k 0.2, push_steal 0.5, resteal_rel 1.0 + read) hold on other
# card rules? Current icm_tag vs each switched back off (seeds 93000+, 400 paired tables, default field).
cd "$(dirname "$0")/.."
# usage: sng_variants_tonight.sh [variants...] (default: all six); output: sng_variants_tonight_<v1+v2...>.md
VARS="${*:-d_omaha4x2 h_plo5 e_shortdeck g_pineapple j_3street f_nlhe20}"
TAG=${*:+_$(echo $* | tr " " "+")}
OUT=results/sng_variants_tonight$TAG.md
C="icm_tag,icm_tag:behind_k=0.8,icm_tag:push_steal=0,icm_tag:resteal_rel=0"
{
echo "# Tonight's switches on other card rules (seeds 93000+, 400 paired tables, default field)"
i=0
for v in $VARS; do
  case $v in d_omaha4x2) i=1;; h_plo5) i=2;; e_shortdeck) i=3;; g_pineapple) i=4;; j_3street) i=5;; f_nlhe20) i=6;; esac
  echo -e "\n## $v\n"
  python3 -m sng.arena --variant $v --candidates "$C" --baseline icm_tag --tables 400 --workers 3 \
    --seed0 $((93000+1000*i)) 2>&1 | grep -A4 "paired"
done
echo done
} > results/logs/sng_variants_tonight$TAG.tmp
mv results/logs/sng_variants_tonight$TAG.tmp $OUT
