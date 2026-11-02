#!/bin/bash
# Field 4 (independent, strongest so far: f4_icm +4.9* over icm_tag). Which of our switches helps here?
# Seeds 73000+, 400 paired tables.
cd "$(dirname "$0")/.."
OUT=results/sng_field4_ab.md
C="icm_tag,icm_tag:resteal=1;resteal_risk=0.5,icm_tag:pev=1;pev_risk=0.5,icm_tag:resteal=1;resteal_risk=0.5;pev=1;pev_risk=0.5,icm_tag:behind_k=0,icm_tag:push_steal=1,icm_tag:pf_chart=1,icm_tag:call_margin=0.03,icm_tag:bet_discount=0.6,f4_icm"
{
echo "# field 4: our switches (seeds 73000+, 400 paired tables)"
python3 -m sng.arena --field field4 --candidates "$C" --baseline icm_tag --tables 400 --workers 3 --seed0 73000 2>&1 | grep -A14 "paired"
echo done
} > results/logs/sng_field4_ab.tmp
mv results/logs/sng_field4_ab.tmp $OUT
