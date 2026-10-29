#!/usr/bin/env bash
# Records Jane's product demo video (./README.md) on sample data: a production build on the
# scratch database, a desktop (1280x720) and a phone (390x844) recording, converted to MP4 and
# copied to DEMO_VIDEO_DEST. Nothing here touches the live site or the live database.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
out="$here/out"
dest="${DEMO_VIDEO_DEST:-$HOME/Desktop/Jane demo video}"
export DEMO_DATABASE_URL="${DEMO_DATABASE_URL:-postgresql://postgres:postgres@localhost:55432/jane_demo_video}"
cd "$root"

# 1. The scratch database: made if missing, in UTC (see the scratch-DB note), migrated.
node --input-type=module -e '
  import pg from "pg";
  const url = new URL(process.env.DEMO_DATABASE_URL);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("DEMO_DATABASE_URL must be a local scratch database");
  }
  const name = url.pathname.slice(1);
  const admin = new URL(url); admin.pathname = "/postgres";
  const c = new pg.Client({ connectionString: admin.href });
  await c.connect();
  const { rowCount } = await c.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
  if (!rowCount) await c.query(`CREATE DATABASE "${name}"`);
  await c.query(`ALTER DATABASE "${name}" SET timezone TO \x27UTC\x27`);
  await c.end();
'
DATABASE_URL="$DEMO_DATABASE_URL" DIRECT_URL="$DEMO_DATABASE_URL" npx prisma migrate deploy

# 2. The landing page's licensed headline font, if this machine has it (never committed).
font="${JULIETTE_FONT:-$(git rev-parse --path-format=absolute --git-common-dir)/../.vercel/assets/public/fonts/juliette.ttf}"
if [ ! -f public/fonts/juliette.ttf ] && [ -f "$font" ]; then
  mkdir -p public/fonts && cp "$font" public/fonts/juliette.ttf
fi
[ -f public/fonts/juliette.ttf ] || echo "No Juliette font: the landing headline uses its fallback."

# 3. A production build with the flags the e2e production build uses (skip with SKIP_BUILD=1).
if [ "${SKIP_BUILD:-}" != 1 ]; then
  DATABASE_URL="$DEMO_DATABASE_URL" DIRECT_URL="$DEMO_DATABASE_URL" \
    TRY_JANE=1 DEMO_BANK=1 DEMO_ADVICE=1 SIMULATED_AGENT=1 npx next build
fi

# 4. Record both (the stills of each step land in out/stills, to look over).
rm -rf "$out"
npx playwright test --config "$here/playwright.config.ts"

# 5. MP4: ffmpeg if it's here; otherwise Playwright's own ffmpeg decodes the recording to frames
# and macOS's AVFoundation encodes them (frames-to-mp4.swift). The blank first second is cut.
pw_ffmpeg="$(ls -d "$HOME"/Library/Caches/ms-playwright/ffmpeg-*/ffmpeg-mac 2>/dev/null | tail -1 || true)"
for webm in "$out"/jane-demo-*.webm; do
  name="$(basename "$webm" .webm)"
  trim="$(node -p "require('$out/$name.json').trimStart")"
  if command -v ffmpeg >/dev/null; then
    ffmpeg -loglevel error -y -ss "$trim" -i "$webm" -c:v libx264 -crf 18 -preset slow \
      -pix_fmt yuv420p -movflags +faststart "$out/$name.mp4"
  elif [ -n "$pw_ffmpeg" ] && command -v swift >/dev/null; then
    frames="$out/frames-$name"
    rm -rf "$frames" && mkdir -p "$frames"
    "$pw_ffmpeg" -loglevel error -ss "$trim" -i "$webm" -r 25 "$frames/%05d.png"
    # The compiler's notes go to a log, shown only if it fails.
    swift "$here/frames-to-mp4.swift" "$frames" "$out/$name.mp4" 25 2>"$out/$name-swift.log" ||
      { cat "$out/$name-swift.log"; exit 1; }
    rm -rf "$frames"
  else
    echo "No ffmpeg and no swift: keeping $name.webm only."
  fi
done

# 6. Copy the finished files out.
mkdir -p "$dest"
for webm in "$out"/jane-demo-*.webm; do
  name="$(basename "$webm" .webm)"
  if [ -f "$out/$name.mp4" ]; then cp "$out/$name.mp4" "$dest/"; else cp "$webm" "$dest/"; fi
done
echo "Done: $(ls "$dest" | tr '\n' ' ')in $dest"
