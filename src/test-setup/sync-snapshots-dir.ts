import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The folder the run's test files share demo-sync snapshots in (src/test-setup/sync-snapshots.ts):
// made fresh for each run, so code changed since the last run is never served an old sync, and
// removed at the end.
let dir: string | null = null;

export function setup() {
  dir = mkdtempSync(join(tmpdir(), "jane-sync-snapshots-"));
  process.env.SYNC_SNAPSHOT_DIR = dir;
}

export function teardown() {
  if (dir) rmSync(dir, { recursive: true, force: true });
}
