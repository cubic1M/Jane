#!/bin/sh
# Runs a hook script with node, which isn't on the path a hook gets from the desktop app. If no node
# can be found the hook steps aside (exit 0): CI is the real control, and a session must keep working.
script="$(dirname "$0")/$1"
if ! command -v node >/dev/null 2>&1; then
  for candidate in "$HOME"/.nvm/versions/node/*/bin /opt/homebrew/bin /usr/local/bin; do
    if [ -x "$candidate/node" ]; then
      PATH="$candidate:$PATH"
      export PATH
      break
    fi
  done
fi
command -v node >/dev/null 2>&1 || exit 0
exec node "$script"
