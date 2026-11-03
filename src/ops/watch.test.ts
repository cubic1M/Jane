import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decide, probeCounts, secretFor } from "../../scripts/ops/watch-core.mjs";
import { deployState } from "../../scripts/ops/vercel.mjs";
import { journeys } from "../../scripts/ops/journeys.mjs";

const now = "2026-11-03T12:00:00.000Z";
const well = { app: true, db: true };
const deploy = {
  createdAt: "2026-11-03T11:30:00.000Z",
  ageMinutes: 30,
  previousUrl: "https://last-good.vercel.app",
};
const quiet = { health: well, probe: { leaks: 0, others: 0 }, jobs: [], deploy, log: [], now };
const did = (actions: { do: string; name?: string }[]) =>
  actions.map((a) => (a.do === "switch" ? `switch:${a.name}` : a.do));

describe("the fixed triggers", () => {
  it("does nothing when nothing's wrong", () => {
    expect(decide(quiet)).toEqual([]);
  });

  it("on a leak: stops new data, rolls back, freezes and pages", () => {
    const actions = decide({ ...quiet, probe: { leaks: 1, others: 0 } });
    expect(did(actions)).toEqual(["switch:banks", "switch:uploads", "rollback", "freeze", "page"]);
  });

  it("on a leak rolls back however old the deploy is", () => {
    const old = { ...deploy, ageMinutes: 5000 };
    expect(did(decide({ ...quiet, deploy: old, probe: { leaks: 1, others: 0 } }))).toContain(
      "rollback",
    );
  });

  it("stops the site only when a leak survives a rollback", () => {
    const log = [{ kind: "rollback", at: "2026-11-03T11:50:00.000Z" }];
    const actions = decide({ ...quiet, log, probe: { leaks: 1, others: 0 } });
    expect(did(actions)).toEqual([
      "switch:banks",
      "switch:uploads",
      "switch:site",
      "freeze",
      "page",
    ]);
  });

  it("never sets KILL_SITE for anything but a leak, and KILL_EMAIL for nothing", () => {
    const log = [{ kind: "rollback", at: "2026-11-03T11:50:00.000Z" }];
    for (const seen of [
      { health: { app: false, db: true } },
      { probe: { leaks: 0, others: 3 } },
      { health: { app: false, db: false }, log },
      { probe: { leaks: 0, others: 3 }, log },
    ]) {
      expect(did(decide({ ...quiet, ...seen }))).not.toContain("switch:site");
    }
    const source = readFileSync("scripts/ops/watch-core.mjs", "utf8");
    expect(source).not.toMatch(/name: "email"/);
  });

  it("when the site is down: rolls back a recent deploy", () => {
    const actions = decide({ ...quiet, health: { app: false, db: true } });
    expect(did(actions)).toEqual(["rollback", "freeze", "page"]);
  });

  it("when the site is down with no recent deploy: pages, since code didn't do it", () => {
    const old = { ...deploy, ageMinutes: 500 };
    const actions = decide({ ...quiet, deploy: old, health: { app: true, db: false } });
    expect(did(actions)).toEqual(["page"]);
  });

  it("rolls back at most once in six hours", () => {
    const log = [{ kind: "rollback", at: "2026-11-03T09:00:00.000Z" }];
    expect(did(decide({ ...quiet, log, health: { app: false, db: true } }))).toEqual(["page"]);
    const longAgo = [{ kind: "rollback", at: "2026-11-03T05:00:00.000Z" }];
    expect(did(decide({ ...quiet, log: longAgo, health: { app: false, db: true } }))).toContain(
      "rollback",
    );
  });

  it("pages once an hour for the same thing", () => {
    const old = { ...deploy, ageMinutes: 500 };
    const log = [{ kind: "page", trigger: "down", at: "2026-11-03T11:30:00.000Z" }];
    expect(decide({ ...quiet, deploy: old, log, health: { app: false, db: true } })).toEqual([]);
  });

  describe("a failed scheduled job", () => {
    const job = (over = {}) => ({
      name: "digest",
      lastOk: false,
      previousOk: true,
      lastFinishedAt: "2026-11-03T11:45:00.000Z",
      ...over,
    });
    it("rolls back if it broke after this deploy", () => {
      expect(did(decide({ ...quiet, jobs: [job()] }))).toEqual(["rollback", "freeze", "page"]);
    });
    it("leaves it if it was already failing, or failed before this deploy", () => {
      expect(decide({ ...quiet, jobs: [job({ previousOk: false })] })).toEqual([]);
      expect(decide({ ...quiet, jobs: [job({ previousOk: null })] })).toEqual([]);
      const before = job({ lastFinishedAt: "2026-11-03T11:00:00.000Z" });
      expect(decide({ ...quiet, jobs: [before] })).toEqual([]);
    });
  });

  it("leaves a site someone stopped on purpose alone", () => {
    expect(decide({ ...quiet, health: { app: false, db: false, paused: true } })).toEqual([]);
  });

  it("tries again after a rollback that failed", () => {
    const log = [{ kind: "rollback", ok: false, at: "2026-11-03T11:50:00.000Z" }];
    expect(did(decide({ ...quiet, log, health: { app: false, db: true } }))).toContain("rollback");
  });

  it("can't roll back with nowhere to go, and says so by paging", () => {
    const only = { ...deploy, previousUrl: null };
    expect(did(decide({ ...quiet, deploy: only, health: { app: false, db: true } }))).toEqual([
      "page",
    ]);
    expect(did(decide({ ...quiet, deploy: null, health: { app: false, db: true } }))).toEqual([
      "page",
    ]);
  });

  it("reaches for the higher secret only for the site", () => {
    expect(secretFor("site")).toBe("OPS_HIGH_BAR_SECRET");
    for (const name of ["banks", "uploads", "claude"]) {
      expect(secretFor(name)).toBe("OPS_REDUCE_SECRET");
    }
  });

  it("reads a probe by its flags, and an answer it can't read as a failure", () => {
    const checks = [
      { name: "a", ok: false, leak: true },
      { name: "b", ok: false },
      { name: "c", ok: true, leak: true },
    ];
    expect(probeCounts({ checks })).toEqual({ leaks: 1, others: 1 });
    expect(probeCounts(null)).toEqual({ leaks: 0, others: 1 });
    expect(probeCounts({ error: "Unauthorized" })).toEqual({ leaks: 0, others: 1 });
  });
});

describe("what the scripts can reach", () => {
  const read = (name: string) => readFileSync(`scripts/ops/${name}`, "utf8");
  it("the watch holds no database, no restore and no model", () => {
    for (const name of [
      "watch.mjs",
      "watch-core.mjs",
      "vercel.mjs",
      "ops-log.mjs",
      "journeys.mjs",
    ]) {
      const code = read(name)
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
      expect(code, name).not.toMatch(
        /DATABASE_URL|DIRECT_URL|prisma|pg_restore|psql|neonctl|anthropic/i,
      );
    }
  });
  it("Vercel is asked for a rollback and a list, and nothing else", () => {
    const code = read("vercel.mjs");
    expect(code).toContain('"rollback"');
    expect(code).not.toMatch(/"(deploy|promote|rm|remove|env|alias)"/);
    expect(code.match(/fetch\(/g)).toHaveLength(1);
  });
});

describe("which deployment to go back to", () => {
  it("is the one before the current, by time", () => {
    const state = deployState(
      [
        { url: "new.vercel.app", created: Date.parse("2026-11-03T11:30:00.000Z") },
        { url: "old.vercel.app", created: Date.parse("2026-11-03T10:00:00.000Z") },
      ],
      now,
    );
    expect(state).toEqual({
      createdAt: "2026-11-03T11:30:00.000Z",
      ageMinutes: 30,
      previousUrl: "https://old.vercel.app",
    });
  });
  it("is unknown without a token or a list", () => {
    expect(deployState(null, now)).toBeNull();
    expect(deployState([], now)).toBeNull();
  });
});

describe("the candidate's journeys", () => {
  const site =
    (over: Record<string, () => Response> = {}): typeof fetch =>
    async (input) => {
      const path = new URL(String(input)).pathname;
      if (over[path]) return over[path]();
      if (path === "/api/health") return Response.json({ ok: true, commit: "abc" });
      if (path === "/api/health/db") return Response.json({ ok: true });
      if (path === "/") {
        return new Response('<script nonce="x"></script>', {
          headers: { "content-security-policy": "script-src 'nonce-x'" },
        });
      }
      if (path === "/api/cron/probe") return Response.json({ ok: true, checks: [] });
      return new Response("?", { status: 500 });
    };
  const run = (fetcher: typeof fetch, extra = {}) =>
    journeys("https://candidate.test", { fetcher, probeSecret: "s", ...extra });
  const failing = async (fetcher: typeof fetch, extra = {}) =>
    (await run(fetcher, extra)).checks
      .filter((c: { ok: boolean }) => !c.ok)
      .map((c: { name: string }) => c.name);

  it("pass on a good build", async () => {
    expect((await run(site(), { commit: "abc" })).ok).toBe(true);
  });
  it("stop a build that's the wrong commit", async () => {
    expect(await failing(site(), { commit: "other" })).toEqual([
      "it is the commit we meant to ship",
    ]);
  });
  it("stop a build whose database doesn't answer", async () => {
    const bad = site({ "/api/health/db": () => new Response("no", { status: 503 }) });
    expect(await failing(bad)).toEqual(["the database answers"]);
  });
  it("stop a page with nothing able to run", async () => {
    const bad = site({ "/": () => new Response("<script></script>") });
    expect(await failing(bad)).toEqual(["the landing page can run its scripts"]);
  });
  it("stop a build that fails the probe, or when the probe couldn't run", async () => {
    const bad = site({
      "/api/cron/probe": () => Response.json({ ok: false, checks: [] }, { status: 503 }),
    });
    expect(await failing(bad)).toEqual(["the probe's journeys pass"]);
    expect(await failing(site(), { probeSecret: undefined })).toEqual([
      "the probe's journeys pass",
    ]);
  });
  it("send the bypass only where it's given", async () => {
    const seen: (string | null)[] = [];
    const spy: typeof fetch = async (input, init) => {
      seen.push(new Headers(init?.headers).get("x-vercel-protection-bypass"));
      return site()(input, init);
    };
    await run(spy, { bypass: "b" });
    expect(new Set(seen)).toEqual(new Set(["b"]));
  });
});
