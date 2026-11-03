#!/bin/sh
# The live check after a deploy: the same three pages as green-deploy.sh, each with one more try
# after 30 seconds. With EXPECT_COMMIT set, the site must also say it's built from that commit, so a
# deploy that never took over can't pass on the old build's health.
SITE="${SITE:-https://jane-dusky.vercel.app}"
WAIT="${WAIT:-30}"

for path in / /import /api/health; do
  code=$(curl -s -o /dev/null -m 30 -w '%{http_code}' "$SITE$path")
  if [ "$code" != 200 ]; then
    sleep "$WAIT"
    code=$(curl -s -o /dev/null -m 30 -w '%{http_code}' "$SITE$path")
    [ "$code" = 200 ] || { echo "live check: $path gave $code"; exit 1; }
  fi
done

if [ -n "$EXPECT_COMMIT" ]; then
  for try in 1 2 3 4; do
    case "$(curl -s -m 30 "$SITE/api/health")" in
      *"\"commit\":\"$EXPECT_COMMIT\""*) live=yes ;;
      *) live=no ;;
    esac
    [ "$live" = yes ] && { echo "live check: ok on the new commit"; exit 0; }
    [ "$try" = 4 ] || sleep "$WAIT"
  done
  echo "live check: the site isn't on the new commit"
  exit 1
fi
echo "live check: ok"
