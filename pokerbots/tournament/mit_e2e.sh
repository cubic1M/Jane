#!/usr/bin/env bash
# End-to-end test of tournament/mit_adapter.py inside the real MIT Pokerbots engine.
#   tournament/mit_e2e.sh /path/to/engine-2026 [our_bot] [rounds]
# Copies the engine to a temp dir, puts our adapter in as player A (vs MIT's sample
# bot as B), uses tournament/pkrbot_shim.py in place of pkrbot if it is not
# installed, runs, and prints the result plus any adapter warnings.
set -euo pipefail
ENGINE=${1:?path to engine-2026}; BOT=${2:-balanced}; ROUNDS=${3:-300}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T=$(mktemp -d); cp -r "$ENGINE"/{engine.py,config.py,python_skeleton} "$T"/
cp -r "$T/python_skeleton" "$T/ours_bot"; cp "$ROOT/tournament/mit_player.py" "$T/ours_bot/player.py"
python3 -c "import pkrbot" 2>/dev/null || cp "$ROOT/tournament/pkrbot_shim.py" "$T/pkrbot.py"
sed -i "s#^PLAYER_1_PATH = .*#PLAYER_1_PATH = \"./ours_bot\"#; s#^NUM_ROUNDS = .*#NUM_ROUNDS = $ROUNDS#" "$T/config.py"
cd "$T" && POKERBOTS_ROOT="$ROOT" OUR_BOT="$BOT" python3 engine.py > /dev/null
grep "^Final" gamelog.txt; grep -c -i -E "attempted|invalid" gamelog.txt || true
grep -h "\[adapter\]" A.txt 2>/dev/null | head -5 || true
echo "logs in $T"
