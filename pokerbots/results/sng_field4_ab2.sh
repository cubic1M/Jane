#!/bin/bash
# Field 4, part 2: are our steal widenings (steal_bonus, push_steal) exploited by adaptive bots?
# Seeds 74000+, 400 paired tables in field 4, then the same candidates on all3 (300 tables).
cd "$(dirname "$0")/.."
OUT=results/sng_field4_ab2.md
C="icm_tag,icm_tag:push_steal=0,icm_tag:steal_bonus=0.3,icm_tag:steal_bonus=0,icm_tag:steal_floor=0.7,icm_tag:steal_floor=0.7;push_steal=0"
{
echo "# field 4 part 2: steal widening (seeds 74000+)"
for cell in "--field field4 --tables 400" "--field all3 --tables 300"; do
  echo -e "\n## $cell\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --workers 3 --seed0 74000 2>&1 | grep -A8 "paired"
done
echo done
} > results/logs/sng_field4_ab2.tmp
mv results/logs/sng_field4_ab2.tmp $OUT
