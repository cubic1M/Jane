import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setup, teardown } from "./sync-snapshots-dir";

describe("the folder a run's snapshots are shared in", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("makes a fresh one and removes it at the end", () => {
    vi.stubEnv("SYNC_SNAPSHOT_DIR", "");
    setup();
    const made = process.env.SYNC_SNAPSHOT_DIR!;
    expect(existsSync(made)).toBe(true);
    teardown();
    expect(existsSync(made)).toBe(false);
  });

  it("keeps a folder it was handed, with what's in it, since other shards' copies came from it", () => {
    const handed = mkdtempSync(join(tmpdir(), "handed-"));
    writeFileSync(join(handed, "key.json"), "{}");
    vi.stubEnv("SYNC_SNAPSHOT_DIR", handed);
    setup();
    teardown();
    expect(existsSync(join(handed, "key.json"))).toBe(true);
    rmSync(handed, { recursive: true, force: true });
  });
});
