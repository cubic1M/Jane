import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BASELINE_FILES,
  FOUNDER_LABEL,
  allowedDrop,
  baselineDrops,
  fixMarking,
  founderApproval,
  isProtectedPath,
  metricDirection,
  proofPlan,
  readVitestReport,
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

  it("reads how far the tests let a score slip", () => {
    expect(allowedDrop("const ALLOWED_DROP = 0.03;\n")).toBe(0.03);
    expect(allowedDrop("no such thing")).toBeNull();
    expect(allowedDrop(readFileSync("src/accuracy/accuracy.test.ts", "utf8"))).toBe(0.03);
    expect(allowedDrop(readFileSync("src/accuracy/csv/csv-accuracy.test.ts", "utf8"))).toBe(0.03);
  });
});

describe("protected files", () => {
  it.each([
    ".claude/settings.json",
    ".claude/hooks/deny.mjs",
    ".mcp.json",
    ".github/workflows/ci.yml",
    ".github/scripts/gates/core.mjs",
    ".github/scripts/merge_train.py",
    "src/config/advice.ts",
  ])("%s needs a founder", (file) => {
    expect(isProtectedPath(file)).toBe(true);
  });

  it.each(["src/config/detection.ts", "docs/gates.md", ".claude", "src/.claude/x"])(
    "%s doesn't",
    (file) => {
      expect(isProtectedPath(file)).toBe(false);
    },
  );
});

describe("the founder's label", () => {
  const good = {
    labels: [FOUNDER_LABEL],
    labelEvents: [{ label: FOUNDER_LABEL, actor: "founder", at: "2026-11-03T10:00:00Z" }],
    founders: ["founder"],
    author: "cubic1M",
    headCommitDate: "2026-11-03T09:00:00Z",
  };

  it("counts when a founder other than the PR's author put it on after the last commit", () => {
    expect(founderApproval(good)).toEqual({ ok: true, why: "approved by founder" });
  });

  it("is required", () => {
    expect(founderApproval({ ...good, labels: [] }).ok).toBe(false);
  });

  it("doesn't count while FOUNDER_LOGINS is empty", () => {
    const result = founderApproval({ ...good, founders: [] });
    expect(result.ok).toBe(false);
    expect(result.why).toContain("FOUNDER_LOGINS");
  });

  it("doesn't count from a login that isn't a founder's", () => {
    const labelEvents = [{ label: FOUNDER_LABEL, actor: "agent", at: "2026-11-03T10:00:00Z" }];
    expect(founderApproval({ ...good, labelEvents }).ok).toBe(false);
  });

  it("doesn't count from the shared login that opened the PR, even if listed as a founder", () => {
    const labelEvents = [{ label: FOUNDER_LABEL, actor: "cubic1M", at: "2026-11-03T10:00:00Z" }];
    const result = founderApproval({ ...good, labelEvents, founders: ["cubic1M"] });
    expect(result.ok).toBe(false);
    expect(result.why).toContain("also opened the PR");
  });

  it("goes by who put it on most recently", () => {
    const labelEvents = [
      { label: FOUNDER_LABEL, actor: "founder", at: "2026-11-03T09:30:00Z" },
      { label: FOUNDER_LABEL, actor: "agent", at: "2026-11-03T10:00:00Z" },
    ];
    expect(founderApproval({ ...good, labelEvents }).ok).toBe(false);
  });

  it("goes stale when a commit lands after it", () => {
    const result = founderApproval({ ...good, headCommitDate: "2026-11-03T11:00:00Z" });
    expect(result.ok).toBe(false);
    expect(result.why).toContain("older than");
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

const diffOf = (file: string, lines: string[]) =>
  [`--- a/${file}`, `+++ b/${file}`, "@@ -1 +1 @@", ...lines].join("\n");

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

  it("flags a test file deleted, not any other file", () => {
    expect(weakenedTests("", ["src/lib/gone.test.ts", "src/lib/gone.ts"])).toEqual([
      { file: "src/lib/gone.test.ts", kind: "file deleted", was: "", now: "" },
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

  it("doesn't flag new expect lines, or lines in a file that isn't a test", () => {
    expect(weakenedTests(diffOf(file, ["+  expect(total).toBe(3);"]))).toEqual([]);
    expect(weakenedTests(diffOf("src/lib/x.ts", ["-  expect(total).toBe(3);"]))).toEqual([]);
  });

  it("reads an end-to-end spec too", () => {
    const spec = "e2e/home.spec.ts";
    const flags = weakenedTests(diffOf(spec, ['-  await expect(page).toHaveTitle("Jane");']));
    expect(flags).toHaveLength(1);
    expect(flags[0].file).toBe(spec);
  });
});
