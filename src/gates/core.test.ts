import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BASELINE_FILES,
  baselineDrops,
  fixMarking,
  founderApproval,
  isProtectedPath,
  isWatchedPath,
  metricDirection,
  parseNameStatus,
  proofPlan,
  readVitestReport,
  scriptsChanged,
  testFilesGone,
  weakenedTests,
} from "../../.github/scripts/gates/core.mjs";

describe("accuracy baselines only rise", () => {
  it("passes a score that rose or stayed, and a new metric", () => {
    const before = { tuning: { subscriptions: { precision: 0.9, recall: 1 } } };
    const after = {
      tuning: { subscriptions: { precision: 0.95, recall: 1 } },
      newSet: { subscriptions: { precision: 0.5, recall: 0.5 } },
    };
    expect(baselineDrops(before, after)).toEqual([]);
  });

  it("fails a precision or recall that fell", () => {
    const drops = baselineDrops(
      { tuning: { bills: { precision: 1, recall: 0.9975 } } },
      { tuning: { bills: { precision: 1, recall: 0.99 } } },
    );
    expect(drops).toEqual([{ path: "tuning / bills / recall", was: 0.9975, now: 0.99 }]);
  });

  it("fails a dotted share in the CSV baseline that fell", () => {
    expect(
      baselineDrops(
        { tuning: { "idle_cash.recall": 0.875 } },
        { tuning: { "idle_cash.recall": 0.8571 } },
      ),
    ).toHaveLength(1);
  });

  it("treats an error or a count as better when it falls", () => {
    expect(baselineDrops({ t: { dollarError: 0.2 } }, { t: { dollarError: 0.1 } })).toEqual([]);
    expect(baselineDrops({ t: { extraRows: 0 } }, { t: { extraRows: 3 } })).toEqual([
      { path: "t / extraRows", was: 0, now: 3 },
    ]);
  });

  it("fails a score or a whole set taken out of the baseline", () => {
    expect(baselineDrops({ a: { recall: 1 }, b: { recall: 1 } }, { a: { recall: 1 } })).toEqual([
      { path: "b / recall", was: 1, now: null },
    ]);
  });

  it("fails a baseline file deleted outright", () => {
    expect(baselineDrops({ a: { recall: 1 } }, null)).toHaveLength(1);
  });

  it("fails a score that stopped being a number", () => {
    expect(baselineDrops({ t: { recall: 1 } }, { t: { recall: null } })).toEqual([
      { path: "t / recall", was: 1, now: null },
    ]);
    expect(baselineDrops({ t: { recall: 1 } }, { t: { recall: "1" } })).toHaveLength(1);
  });

  it("doesn't call float noise a drop", () => {
    expect(
      baselineDrops({ t: { categoryRight: 0.9980047161255214 } }, { t: { categoryRight: 0.998 } }),
    ).toHaveLength(1);
    expect(baselineDrops({ t: { recall: 0.3 } }, { t: { recall: 0.1 + 0.2 } })).toEqual([]);
  });

  it("knows which way every metric in the real baselines should go", () => {
    for (const file of BASELINE_FILES) {
      const baseline = JSON.parse(readFileSync(file, "utf8"));
      const names = new Set<string>();
      const walk = (value: object) => {
        for (const [key, inner] of Object.entries(value)) {
          if (inner !== null && typeof inner === "object") walk(inner);
          else names.add(key);
        }
      };
      walk(baseline);
      for (const name of names) expect(metricDirection(name), name).not.toBe("unknown");
    }
  });
});

describe("protected files", () => {
  it.each([
    ".claude/settings.json",
    ".claude/hooks/deny.mjs",
    ".mcp.json",
    ".github/workflows/ci.yml",
    ".github/workflows/gates.yml",
    ".github/workflows/merge-train.yml",
    ".github/workflows/rerun-flaky.yml",
    ".github/scripts/gates/core.mjs",
    ".github/scripts/merge_train.py",
    "src/config/advice.ts",
    "src/accuracy/accuracy.test.ts",
    "src/accuracy/csv/csv-accuracy.test.ts",
    "vitest.config.mts",
    "vitest.workspace.ts",
    "src/test-setup/no-anthropic.ts",
  ])("%s needs a founder", (file) => {
    expect(isProtectedPath(file)).toBe(true);
  });

  it.each([
    // A Mac's disk finds these at the real paths.
    ".CLAUDE/settings.local.json",
    ".Claude/hooks/deny.mjs",
    ".MCP.json",
    "SRC/config/ADVICE.ts",
    // Nested, and a symlink standing in for the whole folder.
    "src/.claude/settings.json",
    "packages/app/.mcp.json",
    ".claude",
    ".github/workflows",
  ])("%s needs one too", (file) => {
    expect(isProtectedPath(file)).toBe(true);
  });

  it.each(["src/config/detection.ts", "docs/gates.md", "src/claude/x.ts", ".claudefile"])(
    "%s doesn't",
    (file) => {
      expect(isProtectedPath(file)).toBe(false);
    },
  );

  it.each([
    ".github/workflows/scanners.yml",
    ".github/workflows/uptime.yml",
    ".github/dependabot.yml",
    "src/lib/advice-mode.ts",
    "src/lib/guardrails.ts",
    "tsconfig.json",
    ".gitleaks.toml",
    "CLAUDE.md",
    "AGENTS.md",
  ])("%s is flagged, not blocked", (file) => {
    expect(isWatchedPath(file)).toBe(true);
    expect(isProtectedPath(file)).toBe(false);
  });

  it("doesn't flag everyday files, or call a protected file only watched", () => {
    expect(isWatchedPath("src/lib/x.ts")).toBe(false);
    expect(isWatchedPath(".github/workflows/ci.yml")).toBe(false);
  });
});

describe("reading git's list of changed files", () => {
  it("keeps names git would otherwise quote", () => {
    const output = ["M", ".github/workflows/é.yml", "A", "src/a\tb\n.ts", ""].join("\0");
    expect(parseNameStatus(output)).toEqual([
      { status: "M", file: ".github/workflows/é.yml" },
      { status: "A", file: "src/a\tb\n.ts" },
    ]);
  });

  it("reads a rename's two names", () => {
    expect(parseNameStatus(["R097", "a.test.ts", "b.ts", "D", "c.ts", ""].join("\0"))).toEqual([
      { status: "R", from: "a.test.ts", file: "b.ts" },
      { status: "D", file: "c.ts" },
    ]);
  });

  it("is empty for no changes", () => {
    expect(parseNameStatus("")).toEqual([]);
  });
});

describe("package.json's scripts", () => {
  const pkg = (scripts: object, version = "1") => JSON.stringify({ version, scripts });

  it("may stay as they are while the rest changes", () => {
    expect(scriptsChanged(pkg({ test: "vitest run" }), pkg({ test: "vitest run" }, "2"))).toBe(
      false,
    );
  });

  it("count as protected when they change", () => {
    expect(scriptsChanged(pkg({ test: "vitest run" }), pkg({ test: "true" }))).toBe(true);
    expect(scriptsChanged(pkg({ test: "vitest run" }), "not json")).toBe(true);
    expect(scriptsChanged(pkg({ test: "vitest run" }), null)).toBe(true);
  });

  it("don't matter with no package.json to begin with", () => {
    expect(scriptsChanged(null, pkg({ test: "x" }))).toBe(false);
  });
});

describe("a founder's approval", () => {
  const head = "a".repeat(40);
  const good = {
    reviews: [{ login: "founder", state: "APPROVED", commit: head }],
    founders: ["founder"],
    author: "cubic1M",
    headSha: head,
  };

  it("counts on this exact commit, from a founder who didn't open the PR", () => {
    expect(founderApproval(good).ok).toBe(true);
  });

  it("doesn't carry over to a newer commit, whatever date that commit claims", () => {
    const result = founderApproval({ ...good, headSha: "b".repeat(40) });
    expect(result.ok).toBe(false);
    expect(result.why).toContain("older commit");
  });

  it("is required", () => {
    expect(founderApproval({ ...good, reviews: [] }).ok).toBe(false);
  });

  it("can't be given while FOUNDER_LOGINS is empty", () => {
    const result = founderApproval({ ...good, founders: [] });
    expect(result.ok).toBe(false);
    expect(result.why).toContain("FOUNDER_LOGINS");
  });

  it("doesn't count from a login that isn't a founder's", () => {
    const reviews = [{ login: "someone", state: "APPROVED", commit: head }];
    expect(founderApproval({ ...good, reviews }).ok).toBe(false);
  });

  it("doesn't count from the shared login that opened the PR, however it's spelled", () => {
    const reviews = [{ login: "cubic1M", state: "APPROVED", commit: head }];
    expect(founderApproval({ ...good, reviews, founders: ["cubic1M"] }).ok).toBe(false);
    expect(founderApproval({ ...good, reviews, founders: ["CUBIC1m"] }).ok).toBe(false);
  });

  it("matches a founder's login whatever its case", () => {
    expect(founderApproval({ ...good, founders: ["FOUNDER"] }).ok).toBe(true);
  });

  it("goes by the founder's latest word", () => {
    const later = [
      { login: "founder", state: "APPROVED", commit: head },
      { login: "founder", state: "CHANGES_REQUESTED", commit: head },
    ];
    expect(founderApproval({ ...good, reviews: later }).ok).toBe(false);
    const dismissed = [
      { login: "founder", state: "APPROVED", commit: head },
      { login: "founder", state: "DISMISSED", commit: head },
    ];
    expect(founderApproval({ ...good, reviews: dismissed }).ok).toBe(false);
  });

  it("isn't changed by a comment", () => {
    const reviews = [
      { login: "founder", state: "APPROVED", commit: head },
      { login: "founder", state: "COMMENTED", commit: head },
    ];
    expect(founderApproval({ ...good, reviews }).ok).toBe(true);
  });

  it("is held up by either founder asking for changes", () => {
    const reviews = [
      { login: "one", state: "APPROVED", commit: head },
      { login: "two", state: "CHANGES_REQUESTED", commit: head },
    ];
    expect(founderApproval({ ...good, reviews, founders: ["one", "two"] }).ok).toBe(false);
  });
});

describe("what counts as a fix", () => {
  const plain = { title: "Add a page", body: "", branch: "claude/x", labels: [] };

  it("isn't assumed", () => {
    expect(fixMarking(plain).isFix).toBe(false);
  });

  it.each([
    ["a debugger branch", { ...plain, branch: "nd/dmv-not-subscription" }],
    ["a fix branch", { ...plain, branch: "fix/x" }],
    ["the label", { ...plain, labels: ["fix"] }],
    ["the title", { ...plain, title: "fix: a thing" }],
    ["a Proof-of-fix line", { ...plain, body: "Words\nProof-of-fix: the test below\n" }],
  ])("is marked by %s", (_name, pr) => {
    expect(fixMarking(pr).isFix).toBe(true);
  });

  it("lets a PR on a debugger branch say it isn't one, and why", () => {
    const pr = { ...plain, branch: "nd/x", body: "Proof-of-fix: none, docs only" };
    expect(fixMarking(pr)).toEqual({
      isFix: false,
      why: "the PR says it isn't a fix: none, docs only",
    });
  });
});

describe("the proof's plan", () => {
  it("runs the changed tests against the source's old version", () => {
    const { tests, source } = proofPlan([
      { status: "M", file: "src/config/detection.ts" },
      { status: "A", file: "src/lib/new-helper.ts" },
      { status: "M", file: "src/detection/rules/x.test.ts" },
      { status: "A", file: "src/lib/y.integration.test.ts" },
      { status: "A", file: "src/lib/z.test.tsx" },
      { status: "D", file: "src/lib/gone.test.ts" },
      { status: "M", file: "src/accuracy/baseline.json" },
      { status: "M", file: "src/accuracy/__fixtures__/held-out.json" },
      { status: "M", file: "docs/accuracy.md" },
      { status: "M", file: "prisma/schema.prisma" },
    ]);
    expect(tests).toEqual([
      "src/detection/rules/x.test.ts",
      "src/lib/z.test.tsx",
      "src/lib/y.integration.test.ts",
    ]);
    expect(source.map((c: { file: string }) => c.file)).toEqual([
      "src/config/detection.ts",
      "src/lib/new-helper.ts",
    ]);
  });

  it("has no source to go back on for a test-only PR", () => {
    expect(proofPlan([{ status: "M", file: "src/lib/x.test.ts" }]).source).toEqual([]);
  });
});

describe("reading Vitest's report", () => {
  it("tells a real failure from code that isn't there yet", () => {
    const report = readVitestReport({
      testResults: [
        {
          name: "a.test.ts",
          status: "failed",
          assertionResults: [
            { status: "passed", fullName: "ok" },
            {
              status: "failed",
              fullName: "real",
              failureMessages: ["AssertionError: expected 1 to be 2"],
            },
            {
              status: "failed",
              fullName: "new helper",
              failureMessages: ["TypeError: (0 , x.newHelper) is not a function\n at y"],
            },
          ],
        },
        {
          name: "b.test.ts",
          status: "failed",
          message: "Failed to load url ./new-module",
          assertionResults: [],
        },
      ],
    });
    expect(report.passed).toBe(1);
    expect(report.failed.map((f: { test: string }) => f.test)).toEqual(["real"]);
    expect(report.missing.map((f: { test: string }) => f.test)).toEqual([
      "new helper",
      "b.test.ts",
    ]);
  });
});

const diffOf = (file: string, lines: string[]) => [
  { file, diff: [`--- a/${file}`, `+++ b/${file}`, "@@ -1 +1 @@", ...lines].join("\n") },
];

describe("weakened tests", () => {
  const file = "src/lib/x.test.ts";

  it("flags an expect line deleted with nothing in its place", () => {
    const flags = weakenedTests(diffOf(file, ["-  expect(total).toBe(3);"]));
    expect(flags).toEqual([
      { file, kind: "expect deleted", was: "expect(total).toBe(3);", now: "" },
    ]);
  });

  it.each([
    ["expect(total).toBe(3);", "expect(total).toBeDefined();"],
    ["expect(total).toBe(3);", "expect(total).toBeGreaterThan(0);"],
    ["expect(rows).toEqual([1, 2]);", "expect(rows).toContain(1);"],
    ["expect(rows).toContain(1);", "expect(rows).toBeTruthy();"],
    ["expect(spy).toHaveBeenCalledWith(1);", "expect(spy).toHaveBeenCalled();"],
    ["expect(row).toEqual({ a: 1 });", "expect(row).toEqual({ a: expect.anything() });"],
  ])("flags %s loosened to %s", (was, now) => {
    const flags = weakenedTests(diffOf(file, [`-  ${was}`, `+  ${now}`]));
    expect(flags).toEqual([{ file, kind: "expect loosened", was, now }]);
  });

  it("flags a test newly skipped", () => {
    const flags = weakenedTests(diffOf(file, ['+  it.skip("adds up", () => {']));
    expect(flags).toEqual([
      { file, kind: "test skipped", was: "", now: 'it.skip("adds up", () => {' },
    ]);
  });

  it("doesn't flag a line moved, or rewritten as strictly", () => {
    const moved = ["-  expect(total).toBe(3);", "+    expect(total).toBe(3);"];
    expect(weakenedTests(diffOf(file, moved))).toEqual([]);
    const rewritten = ["-  expect(total).toBe(3);", "+  expect(total).toBe(4);"];
    expect(weakenedTests(diffOf(file, rewritten))).toEqual([]);
    const stricter = ["-  expect(total).toBeGreaterThan(1);", "+  expect(total).toBe(4);"];
    expect(weakenedTests(diffOf(file, stricter))).toEqual([]);
  });

  it("doesn't flag new expect lines", () => {
    expect(weakenedTests(diffOf(file, ["+  expect(total).toBe(3);"]))).toEqual([]);
  });

  it("reads an added line that starts like a file header as what it is", () => {
    const lines = ["+++ expect(total).toBe(3);", "-  expect(total).toBe(3);"];
    const flags = weakenedTests(diffOf(file, lines));
    // Two plusses and the line: an added line, so the deleted one was only moved.
    expect(flags).toEqual([]);
  });

  it("reads a removed line that starts like a file header as what it is", () => {
    const flags = weakenedTests(diffOf(file, ["--- expect(total).toBe(3);"]));
    expect(flags).toHaveLength(1);
    expect(flags[0].kind).toBe("expect deleted");
  });

  it("reads an end-to-end spec too", () => {
    const spec = "e2e/home.spec.ts";
    const flags = weakenedTests(diffOf(spec, ['-  await expect(page).toHaveTitle("Jane");']));
    expect(flags).toHaveLength(1);
    expect(flags[0].file).toBe(spec);
  });

  it("passes on the test files that went away", () => {
    const gone = [{ file: "src/a.test.ts", kind: "file deleted" }];
    expect(weakenedTests([], gone)).toEqual([
      { file: "src/a.test.ts", kind: "file deleted", was: "", now: "" },
    ]);
  });
});

describe("test files gone from the run", () => {
  it("finds one deleted, not any other file", () => {
    expect(
      testFilesGone([
        { status: "D", file: "src/lib/gone.test.ts" },
        { status: "D", file: "src/lib/gone.ts" },
      ]),
    ).toEqual([{ file: "src/lib/gone.test.ts", kind: "file deleted" }]);
  });

  it("finds one renamed so it no longer runs", () => {
    const [gone] = testFilesGone([
      { status: "R", from: "src/a.test.ts", file: "src/a.test.ts.off" },
    ]);
    expect(gone.file).toBe("src/a.test.ts.off");
    expect(gone.kind).toContain("no longer runs");
  });

  it("leaves one renamed to another test file", () => {
    expect(testFilesGone([{ status: "R", from: "src/a.test.ts", file: "src/b.test.ts" }])).toEqual(
      [],
    );
  });
});
