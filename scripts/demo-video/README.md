# Demo video

A 60–90 second product demo of Jane on sample data, for applications and investors.

```bash
scripts/demo-video/record.sh
```

It makes a production build, starts it on the scratch Postgres (`localhost:55432`, database
`jane_demo_video`), records the story below on a desktop (1280x720) and a phone (390x844, saved at
twice the pixels), and copies `jane-demo-desktop.mp4` and `jane-demo-phone.mp4` to
`~/Desktop/Jane demo video/`.

The story: the landing page → uploading a sample Chase checking statement → the import finishing →
the findings with their dollars → one finding's proof, how sure Jane is, and its steps → the
checkup → change alerts → the net-worth home. A short caption names each step.

- **Sample data only.** The statement is made up (`sample-statement.ts`), the person is a made-up
  user deleted after the run, and the build talks to no Claude, email, analytics or price service.
- **Scratch database only.** `DEMO_DATABASE_URL` overrides it, and must be a local one.
- **Output** lands in `scripts/demo-video/out/` (gitignored), with a still of every step in
  `out/stills/` to look over without playing the video. Never commit the videos.
- **MP4** comes from `ffmpeg` if it's installed; otherwise Playwright's own ffmpeg decodes the
  recording and macOS's AVFoundation encodes it (`frames-to-mp4.swift`). Without either, you get
  the WebM.
- `SKIP_BUILD=1` reuses the last build; `DEMO_VIDEO_DEST` changes where the files go. The landing
  page's licensed headline font is copied in from the main checkout's `.vercel/assets` when it's
  there (`JULIETTE_FONT` to point elsewhere), never committed.
