import { execFile, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEPLOY,
  LIVE_PATHS,
  decide,
  lastGood,
  newestGreen,
  recorded,
} from "../../scripts/deploy-plan-core.mjs";

const REPO = "cubic1M/Jane";
const NOW = 1_800_000_000;
const SHA = "a".repeat(40);
const run = (over: Record<string, unknown> = {}) => ({
  status: "completed",
  conclusion: "success",
  head_branch: "main",
  head_sha: SHA,
  event: "push",
  head_repository: { full_name: REPO },
  ...over,
});
const ask = (over: Record<string, unknown> = {}) =>
  decide({
    sha: SHA,
    onMain: true,
    olderThanLast: false,
    track: {},
    now: NOW,
    ...over,
  } as never);

describe("which commit is a candidate", () => {
  it("is the newest green run of main", () => {
    const runs = [
      run({ conclusion: "failure", head_sha: "new" }),
      run({ conclusion: "cancelled", head_sha: "newer" }),
      run({ head_sha: "green" }),
      run({ head_sha: "older" }),
    ];
    expect(newestGreen(runs as never, REPO)).toBe("green");
  });

  it("a hand-started run of main counts", () => {
    expect(newestGreen([run({ event: "workflow_dispatch" })] as never, REPO)).toBe(SHA);
  });

  it("never a fork's pull request from a branch called main", () => {
    const runs = [
      run({ head_repository: { full_name: "stranger/Jane" }, head_sha: "evil" }),
      run({ event: "pull_request", head_sha: "evil" }),
      run({ head_branch: "other", head_sha: "evil" }),
    ];
    expect(newestGreen(runs as never, REPO)).toBeNull();
  });
});

describe("whether to ship", () => {
  it("ships a new green commit", () => {
    expect(ask()).toMatchObject({ action: "deploy", sha: SHA });
  });

  it("waits with nothing green, or a commit that isn't on main", () => {
    expect(ask({ sha: null }).action).toBe("wait");
    expect(ask({ onMain: false }).action).toBe("wait");
  });

  it("doesn't ship the same commit twice, or one that failed", () => {
    expect(ask({ track: { last: SHA } }).reason).toBe("already shipped");
    expect(ask({ track: { bad: [SHA] } }).reason).toBe("failed before");
  });

  it("only goes forward", () => {
    expect(ask({ olderThanLast: true }).reason).toBe("older than what's live");
  });

  it("keeps the 15-minute gap", () => {
    const inside = { times: [NOW - DEPLOY.gapSeconds + 1] };
    expect(ask({ track: inside }).reason).toContain("gap");
    expect(ask({ track: { times: [NOW - DEPLOY.gapSeconds] } }).action).toBe("deploy");
  });

  it("keeps the cap of 80 a day, counting only the last 24 hours", () => {
    const start = NOW - 80000;
    const full = Array.from({ length: DEPLOY.capPerDay }, (_, i) => start + i);
    expect(ask({ track: { times: full } }).reason).toContain("cap");
    const old = Array.from({ length: DEPLOY.capPerDay }, (_, i) => NOW - 90000 - i).toReversed();
    expect(ask({ track: { times: old } }).action).toBe("deploy");
  });
});

describe("the record", () => {
  it("a good deploy moves last on, and a bad one doesn't", () => {
    const good = recorded({}, { sha: SHA, now: NOW, ok: true, id: "dpl_1" });
    expect(good.last).toBe(SHA);
    const bad = recorded(good, { sha: "b".repeat(40), now: NOW + 1, ok: false });
    expect(bad.last).toBe(SHA);
    expect(bad.bad).toEqual(["b".repeat(40)]);
    expect(bad.times).toHaveLength(2);
  });

  it("a failed try still counts against the gap", () => {
    const bad = recorded({}, { sha: SHA, now: NOW, ok: false });
    expect(ask({ sha: "b".repeat(40), track: bad }).reason).toContain("gap");
  });

  it("goes back to the last good deployment", () => {
    let track = recorded({}, { sha: "1", now: NOW, ok: true, id: "dpl_1" });
    track = recorded(track, { sha: "2", now: NOW + 1, ok: true, id: "dpl_2" });
    track = recorded(track, { sha: "3", now: NOW + 2, ok: false });
    expect(lastGood(track)).toBe("dpl_2");
    expect(lastGood({})).toBeNull();
  });

  it("forgets what's over a week old", () => {
    const old = recorded({}, { sha: "1", now: NOW - 8 * 86400, ok: true });
    const track = recorded(old, { sha: "2", now: NOW, ok: true });
    expect(track.log).toHaveLength(1);
    expect(track.times).toEqual([NOW]);
  });
});

describe("the workflow", () => {
  const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");

  it("has no trigger a pull request's code can use", () => {
    expect(workflow).not.toMatch(/^\s*pull_request/m);
    expect(workflow).toContain("branches: [main]");
  });

  it("only touches Vercel when a founder has set live, from the protected environment", () => {
    const [beforeShip, shipJob] = workflow.split(/^ {2}ship:$/m);
    expect(beforeShip).not.toContain("VERCEL_TOKEN:");
    expect(shipJob).toContain("needs.plan.outputs.mode == 'live'");
    expect(shipJob).toContain("environment: production");
  });

  it("uploads for Vercel to build, so production's secrets never reach the runner", () => {
    expect(workflow).toContain("deploy --prod --yes");
    expect(workflow).not.toMatch(/vercel(@[\d.]+)? (pull|build)/);
    expect(workflow).not.toContain("DATABASE_URL");
  });

  it("pins the Vercel CLI and keeps build output out of the public log", () => {
    const uses = workflow.match(/vercel@[^ ]+/g) ?? [];
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) expect(use).toMatch(/^vercel@\d+\.\d+\.\d+$/);
    expect(workflow).toContain("> ../build.log 2>&1");
    expect(workflow).not.toMatch(/cat \.\.\/build\.log/);
  });

  it("the licensed font comes from the environment and isn't in the repository", () => {
    expect(workflow).toContain("secrets.LICENSED_FONT_JULIETTE_B64");
    expect(readFileSync(".gitignore", "utf8")).toMatch(/^\/public\/fonts\/$/m);
  });
});

describe("the live check", () => {
  const check = async (
    answer: (path: string) => { status: number; body?: string },
    expect = "",
  ) => {
    const seen: string[] = [];
    const server = createServer((request, response) => {
      seen.push(request.url ?? "");
      const { status, body } = answer(request.url ?? "");
      response.writeHead(status).end(body ?? "");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const script = "scripts/deploy-live-check.sh";
    const env = {
      PATH: process.env.PATH,
      SITE: `http://127.0.0.1:${port}`,
      WAIT: "0",
      EXPECT_COMMIT: expect,
    };
    const passed = await new Promise<boolean>((resolve) => {
      execFile("sh", [script], { env: env as never }, (error) => resolve(!error));
    });
    server.close();
    return { passed, seen };
  };

  it("reads the same three pages as the laptop's loop", async () => {
    const { passed, seen } = await check(() => ({ status: 200 }));
    expect(passed).toBe(true);
    expect(seen).toEqual(LIVE_PATHS);
  });

  it("fails on a page that stays down, and gives it one more try", async () => {
    const { passed, seen } = await check((path) => ({ status: path === "/import" ? 500 : 200 }));
    expect(passed).toBe(false);
    expect(seen.filter((path) => path === "/import")).toHaveLength(2);
  });

  it("passes a page that comes back on its second try", async () => {
    let tries = 0;
    const { passed } = await check((path) => {
      if (path !== "/import") return { status: 200 };
      tries += 1;
      return { status: tries === 1 ? 500 : 200 };
    });
    expect(passed).toBe(true);
  });

  it("with a commit to expect, an old build's health isn't enough", async () => {
    const old = await check(() => ({ status: 200, body: '{"ok":true,"commit":"old"}' }), SHA);
    expect(old.passed).toBe(false);
    const fresh = await check(
      () => ({ status: 200, body: JSON.stringify({ ok: true, commit: SHA }) }),
      SHA,
    );
    expect(fresh.passed).toBe(true);
  });
});

describe("what the deploy expects of the commit", () => {
  it("git archive fills in the file /api/health reads", () => {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const archived = execFileSync(
      "sh",
      ["-c", "git archive HEAD src/config/build-commit.ts | tar -xO"],
      { encoding: "utf8" },
    );
    expect(archived).toContain(`"${head}"`);
  });
});
