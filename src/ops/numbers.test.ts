import { describe, expect, it } from "vitest";
import {
  BASELINE_ENDS,
  areaOf,
  attributionOf,
  autonomy,
  deployLag,
  escapedPer100,
  parseJsonl,
  plantedCaught,
  proofOfFix,
  recoveryMinutes,
  redMainMinutes,
  renderPage,
  rework,
  rolledBack,
  staleTasks,
  usageByLane,
  versionsSeen,
  withToday,
} from "../../scripts/ops/numbers-core.mjs";

const from = "2026-11-02T00:00:00.000Z";
const to = "2026-11-03T00:00:00.000Z";
const run = (conclusion: string, finishedAt: string, sha = "a") => ({
  sha,
  conclusion,
  finishedAt,
});
const pr = (over: Record<string, unknown> = {}) => ({
  title: "A change",
  body: "",
  branch: "claude/x",
  labels: [],
  mergedAt: "2026-11-02T12:00:00.000Z",
  approvedBy: [],
  proofOfFix: null,
  ...over,
});

describe("1: deploy lag", () => {
  const runs = [
    run("success", "2026-11-02T10:00:00Z", "old"),
    run("success", "2026-11-02T11:00:00Z", "new"),
    run("failure", "2026-11-02T11:30:00Z", "red"),
  ];
  it("is the wait since the newest green commit, when it isn't live", () => {
    const lag = deployLag({ runs, isLive: () => false, now: "2026-11-02T12:00:00Z" });
    expect(lag).toBe(60);
  });
  it("is zero when it is live, and unknown when the live commit is", () => {
    expect(deployLag({ runs, isLive: () => true, now: "2026-11-02T12:00:00Z" })).toBe(0);
    expect(deployLag({ runs, isLive: () => null, now: "2026-11-02T12:00:00Z" })).toBeNull();
  });
  it("is unknown with no green run at all, never a reassuring zero", () => {
    expect(deployLag({ runs: [], isLive: () => true, now: to })).toBeNull();
  });
});

describe("2: red main", () => {
  it("runs from a failure to the next green, and a cancelled run changes nothing", () => {
    const runs = [
      run("failure", "2026-11-02T01:00:00Z"),
      run("cancelled", "2026-11-02T01:30:00Z"),
      run("failure", "2026-11-02T01:40:00Z"),
      run("success", "2026-11-02T02:00:00Z"),
    ];
    expect(redMainMinutes(runs, from, to)).toBe(60);
  });
  it("clips to the day, both ways", () => {
    expect(
      redMainMinutes(
        [run("failure", "2026-11-01T23:00:00Z"), run("success", "2026-11-02T00:30:00Z")],
        from,
        to,
      ),
    ).toBe(30);
    expect(redMainMinutes([run("failure", "2026-11-02T23:00:00Z")], from, to)).toBe(60);
  });
});

describe("3 and 4: rollbacks", () => {
  const actions = [
    {
      kind: "rollback",
      at: "2026-11-02T05:10:00.000Z",
      badSince: "2026-11-02T05:00:00.000Z",
    },
    { kind: "freeze", at: "2026-11-02T05:10:00.000Z" },
  ];
  it("counts the script's rollbacks and merged reverts in the day", () => {
    const merged = [pr({ title: "Revert the thing" }), pr({ title: "Reverting nothing" })];
    expect(rolledBack({ merged, actions, from, to })).toBe(2);
    expect(rolledBack({ merged: [], actions, from: to, to: "2026-11-04T00:00:00.000Z" })).toBe(0);
  });
  it("gives the slowest recovery, and null with none", () => {
    expect(recoveryMinutes({ actions, from, to })).toBe(10);
    expect(recoveryMinutes({ actions: [], from, to })).toBeNull();
  });
});

describe("5: escaped bugs", () => {
  it("is per 100 merged PRs, and unknown with none merged", () => {
    const merged = [pr(), pr(), pr(), pr()];
    const escaped = [{ createdAt: "2026-11-02T03:00:00.000Z" }];
    expect(escapedPer100({ merged, escaped, from, to })).toBe(25);
    expect(escapedPer100({ merged: [], escaped, from, to })).toBeNull();
  });
});

describe("6: rework", () => {
  it("is the share of added lines no longer there, by area and overall", () => {
    const result = rework({ lib: 100, app: 100 }, { lib: 75, app: 100 });
    expect(result.byArea.lib).toEqual({ added: 100, changedAgain: 25 });
    expect(result.byArea.app).toEqual({ added: 100, changedAgain: 0 });
    expect(result.changedAgain).toBe(12.5);
  });
  it("is unknown with nothing added, and can't go below zero", () => {
    expect(rework({}, {}).changedAgain).toBeNull();
    expect(rework({ lib: 10 }, { lib: 50 }).changedAgain).toBe(0);
  });
  it("leaves out what nobody wrote by hand", () => {
    expect(areaOf("package-lock.json")).toBeNull();
    expect(areaOf("prisma/migrations/1/migration.sql")).toBeNull();
    expect(areaOf("src/generated/prisma/client.ts")).toBeNull();
    expect(areaOf("src/lib/plaid/sync.ts")).toBe("lib/plaid");
    expect(areaOf("src/detection/streams.ts")).toBe("detection");
    expect(areaOf("e2e/landing.spec.ts")).toBe("e2e");
  });
});

describe("7: proof of fix", () => {
  it("counts a proven fix, a marked one that didn't prove, and an unmarked one", () => {
    const result = proofOfFix([
      pr({ branch: "fix/a", proofOfFix: "SUCCESS" }),
      pr({ branch: "nd/b", proofOfFix: "FAILURE" }),
      pr({ title: "Fixed the crash on upload" }),
      pr({ title: "A new page" }),
    ]);
    expect(result).toEqual({ proved: 1, marked: 2, unmarked: 1, rate: 33.3 });
  });
  it("believes a PR that says it isn't a fix", () => {
    const result = proofOfFix([
      pr({ title: "Fix a typo", branch: "fix/x", body: "Proof-of-fix: none, a typo" }),
    ]);
    expect(result).toEqual({ proved: 0, marked: 0, unmarked: 0, rate: null });
  });
});

describe("8: silent tasks", () => {
  it("finds open work untouched for two hours, leaving out drafts", () => {
    const now = "2026-11-02T12:00:00.000Z";
    const open = [
      { number: 1, isDraft: false, updatedAt: "2026-11-02T09:00:00.000Z" },
      { number: 2, isDraft: true, updatedAt: "2026-11-02T09:00:00.000Z" },
      { number: 3, isDraft: false, updatedAt: "2026-11-02T11:00:00.000Z" },
    ];
    expect(staleTasks(open, now)).toEqual([1]);
  });
});

describe("9: autonomy", () => {
  it("counts a merge as attended only with a founder's approval", () => {
    const merged = [pr({ approvedBy: ["founder"] }), pr({ approvedBy: ["some-bot"] }), pr()];
    const closedUnmerged = [pr()];
    expect(autonomy({ merged, closedUnmerged, founders: ["founder"] })).toEqual({
      unattended: 2,
      closedUnmerged: 1,
    });
  });
});

describe("10: attribution", () => {
  const body =
    "Words.\n\nAgent: lane=scanners model=claude-opus-5-5 claude-code=2.1.309 tokens=1200\n";
  it("reads the line, and nothing else that looks a bit like it", () => {
    expect(attributionOf(body)).toEqual({
      lane: "scanners",
      model: "claude-opus-5-5",
      version: "2.1.309",
      tokens: 1200,
    });
    expect(attributionOf("Agent: someone said so")).toBeNull();
    expect(attributionOf(null)).toBeNull();
  });
  it("gives tokens per PR by lane, and how many PRs said", () => {
    const usage = usageByLane([pr({ body }), pr({ body }), pr()]);
    expect(usage).toEqual({
      attributed: 2,
      lanes: { scanners: { prs: 2, tokensPerPr: 1200 } },
    });
  });
  it("counts PRs by model and version, including those that didn't say", () => {
    expect(versionsSeen([pr({ body }), pr()])).toEqual({
      "claude-opus-5-5 / 2.1.309": 1,
      "not recorded": 1,
    });
  });
});

describe("11: planted bugs", () => {
  it("adds up the day's runs, and is unknown before step 5 exists", () => {
    const planted = [{ at: "2026-11-02T03:00:00.000Z", planted: 10, caught: 7 }];
    expect(plantedCaught(planted, from, to)).toEqual({ caught: 7, planted: 10 });
    expect(plantedCaught([], from, to)).toBeNull();
  });
});

describe("the page", () => {
  const day = {
    day: "2026-11-02",
    merged: 40,
    deployLag: 5,
    rolledBack: 0,
    versions: { "claude-opus-5-5 / 2.1.309": 3 },
  };
  it("shows all eleven numbers and sets no thresholds during the baseline", () => {
    const page = renderPage([day], { now: to });
    for (const name of [
      "Deploy lag",
      "Red main",
      "Rolled back or reverted",
      "Bad deploy to last-good",
      "Escaped bugs per 100 PRs",
      "Lines changed again in 21 days",
      "Proof-of-fix rate",
      "Tasks silent for 2 hours",
      "Merged with no founder approval",
      "Closed unmerged",
      "Tokens per merged PR",
      "Planted bugs caught",
    ]) {
      expect(page).toContain(name);
    }
    expect(page).toContain(`Baselining until ${BASELINE_ENDS}`);
    expect(page).not.toMatch(/target:|threshold:/i);
  });
  it("says no data rather than a number it doesn't have", () => {
    expect(renderPage([day], { now: to })).toMatch(/Bad deploy to last-good[^\n]*no data/);
  });
  it("shows the merged count only beside numbers 3, 5 and 6", () => {
    const rows = renderPage([day], { now: to })
      .split("\n")
      .filter((line) => line.includes("(of 40 merged)"));
    expect(rows.map((row) => row.split("|")[1].trim())).toEqual(["3", "5", "6"]);
  });
  it("shows holdouts and canaries when they've run", () => {
    const page = renderPage([day], {
      now: to,
      holdouts: [{ at: from, sha: "abc12345", passed: 7, total: 8 }],
      canaries: [{ at: from, solved: true, turns: 6, minutes: 2, model: "m", version: "v" }],
    });
    expect(page).toContain("7 of 8 passed");
    expect(page).toContain("| 2026-11-02 | yes | 6 | 2 | m / v |");
  });
});

describe("records", () => {
  it("a re-run on the same day replaces that day", () => {
    const history = [{ day: "2026-11-01" }, { day: "2026-11-02", merged: 1 }];
    expect(withToday(history, { day: "2026-11-02", merged: 2 })).toEqual([
      { day: "2026-11-01" },
      { day: "2026-11-02", merged: 2 },
    ]);
  });
  it("skips a broken line rather than losing the rest", () => {
    expect(parseJsonl('{"a":1}\nnot json\n{"a":2}\n')).toEqual([{ a: 1 }, { a: 2 }]);
  });
});
