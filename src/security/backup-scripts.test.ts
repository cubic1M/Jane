import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The refusals come before anything touches a database or needs Postgres tools, so these run
// anywhere. docs/security/backups.md has the run on real data.
function run(script: string, args: string[], env: Record<string, string>) {
  const { status, stderr } = spawnSync("bash", [`scripts/backup/${script}`, ...args], {
    encoding: "utf8",
    env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", HOME: tmpdir(), ...env },
  });
  return { status, stderr };
}

describe("restore-drill.sh", () => {
  let dir: string;
  let dump: string;
  let key: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "drill-"));
    dump = join(dir, "x.dump.age");
    key = join(dir, "key.txt");
    writeFileSync(dump, "x");
    writeFileSync(key, "x");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const drill = (env: Record<string, string>) => run("restore-drill.sh", [dump, key], env);
  const REMOTE = "postgresql://u:p@ep-example.neon.tech/db";

  it("needs a target", () => {
    expect(drill({}).stderr).toContain("DRILL_DATABASE_URL isn't set");
  });

  it("refuses a target off this machine unless told it's throwaway", () => {
    const { status, stderr } = drill({ DRILL_DATABASE_URL: REMOTE });
    expect(status).toBe(1);
    expect(stderr).toContain("isn't on this machine");
  });

  it.each(["DATABASE_URL", "DIRECT_URL", "BACKUP_DATABASE_URL"])(
    "refuses %s, even when told it's throwaway",
    (name) => {
      const { status, stderr } = drill({
        DRILL_DATABASE_URL: REMOTE,
        DRILL_TARGET_IS_THROWAWAY: "yes",
        [name]: REMOTE,
      });
      expect(status).toBe(1);
      expect(stderr).toContain(`the target is ${name}`);
    },
  );

  it("refuses another database on production's host", () => {
    const { status, stderr } = drill({
      DRILL_DATABASE_URL: "postgresql://u:p@ep-example.neon.tech/other",
      DRILL_TARGET_IS_THROWAWAY: "yes",
      DIRECT_URL: REMOTE,
    });
    expect(status).toBe(1);
    expect(stderr).toContain("same host as DIRECT_URL");
  });

  it("never prints the address or its password", () => {
    expect(drill({ DRILL_DATABASE_URL: REMOTE }).stderr).not.toMatch(/u:p@|ep-example/);
  });
});

describe("dump.sh", () => {
  it("needs a database and a public key, and takes only a public key", () => {
    expect(run("dump.sh", [], {}).stderr).toContain("BACKUP_DATABASE_URL isn't set");
    expect(run("dump.sh", [], { BACKUP_DATABASE_URL: "x" }).stderr).toContain(
      "BACKUP_AGE_RECIPIENT isn't set",
    );
    const { status, stderr } = run("dump.sh", [], {
      BACKUP_DATABASE_URL: "x",
      BACKUP_AGE_RECIPIENT: "AGE-SECRET-KEY-1",
    });
    expect(status).toBe(1);
    expect(stderr).toContain("isn't an age public key");
  });
});
