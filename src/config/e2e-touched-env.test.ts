import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// npm run e2e:touched runs the specs as CI's end-to-end job does, which has no .env. On a
// developer's machine the checkout's .env set ADMIN_EMAILS (/admin answered 404 to the tests'
// admin, upload.spec.ts:265) and APP_URL (Robinhood's way back went to another address,
// robinhood.spec.ts:86): both failed here on main and passed in CI (11-20).

const script = readFileSync("scripts/e2e-touched.mjs", "utf8");

describe("npm run e2e:touched, as CI runs the specs", () => {
  it("keeps the checkout's .env out of the build and the servers", () => {
    expect(script).toMatch(/__NEXT_PROCESSED_ENV: "true"/);
  });

  it("readies the scratch database as CI does, before the build and the specs", () => {
    const migrate = script.indexOf('["prisma", "migrate", "deploy"]');
    const rls = script.indexOf("scripts/rls-protect.mjs");
    const build = script.indexOf('"next", "build"');
    expect(migrate).toBeGreaterThan(0);
    expect(rls).toBeGreaterThan(migrate);
    expect(build).toBeGreaterThan(rls);
  });

  it("relies on a flag this Next.js still honours: with it set, a .env file isn't read", () => {
    const dir = mkdtempSync(join(tmpdir(), "next-env-"));
    writeFileSync(join(dir, ".env"), "E2E_TOUCHED_PROBE=from-the-file\n");
    // The @next/env Next.js itself loads its .env files with: its dependency, not ours, so it is
    // resolved from next and named at run time rather than listed in package.json.
    const fromNext = createRequire(createRequire(import.meta.url).resolve("next/package.json"));
    const { loadEnvConfig } = fromNext(["@next", "env"].join("/")) as {
      loadEnvConfig: (dir: string, dev: boolean, log: object, forceReload?: boolean) => unknown;
    };
    const quiet = { info: () => {}, error: () => {} };
    const before = { ...process.env };
    try {
      process.env.__NEXT_PROCESSED_ENV = "true";
      loadEnvConfig(dir, false, quiet);
      expect(process.env.E2E_TOUCHED_PROBE).toBeUndefined();
      // And the file is one Next.js reads without the flag.
      delete process.env.__NEXT_PROCESSED_ENV;
      loadEnvConfig(dir, false, quiet, true);
      expect(process.env.E2E_TOUCHED_PROBE).toBe("from-the-file");
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
      Object.assign(process.env, before);
    }
  });
});
