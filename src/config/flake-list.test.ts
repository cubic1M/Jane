import { describe, expect, it } from "vitest";
import {
  flakeList,
  fromPlaywright,
  fromVitest,
  keepRecent,
  parseRecords,
  recordOf,
  renderFlakes,
} from "../../scripts/flake-list-core.mjs";

const NOW = "2026-11-03T12:00:00Z";
const run = (over: Record<string, unknown> = {}) => ({
  run: 1,
  attempt: 1,
  ran: 100,
  branch: "main",
  at: "2026-11-02T12:00:00Z",
  jobsFailed: [] as string[],
  tests: [] as { id: string; kind: string; first: string; last: string }[],
  ...over,
});
const flaky = (id: string) => ({ id, kind: "e2e", first: "failed", last: "passed" });
const red = (id: string) => ({ id, kind: "e2e", first: "failed", last: "failed" });

const results = (...statuses: string[]) => statuses.map((status, retry) => ({ status, retry }));
const spec = (title: string, status: string, tries: string[]) => ({
  title,
  file: "a.spec.ts",
  tests: [
    { projectName: "chromium", status, expectedStatus: "passed", results: results(...tries) },
  ],
});

describe("reading Playwright's report", () => {
  const report = {
    suites: [
      {
        title: "a.spec.ts",
        specs: [
          spec("passes", "expected", ["passed"]),
          spec("needed a retry", "flaky", ["failed", "passed"]),
          spec("never passed", "unexpected", ["timedOut", "failed", "failed"]),
          spec("skipped", "skipped", ["skipped"]),
        ],
        suites: [{ title: "signed in", specs: [spec("nested", "flaky", ["timedOut", "passed"])] }],
      },
    ],
  };

  it("finds what failed on the first try, even when a retry passed", () => {
    const { ran, tests } = fromPlaywright(report);
    expect(ran).toBe(4);
    expect(tests).toEqual([
      {
        id: "[chromium] e2e/a.spec.ts › needed a retry",
        kind: "e2e",
        first: "failed",
        last: "passed",
      },
      {
        id: "[chromium] e2e/a.spec.ts › never passed",
        kind: "e2e",
        first: "timedOut",
        last: "failed",
      },
      {
        id: "[chromium] e2e/a.spec.ts › signed in › nested",
        kind: "e2e",
        first: "timedOut",
        last: "passed",
      },
    ]);
  });

  it("doesn't count a test that's expected to fail", () => {
    const expectedFail = {
      suites: [
        {
          specs: [
            {
              title: "known bug",
              file: "a.spec.ts",
              tests: [
                {
                  projectName: "mobile",
                  status: "expected",
                  expectedStatus: "failed",
                  results: results("failed"),
                },
              ],
            },
          ],
        },
      ],
    };
    expect(fromPlaywright(expectedFail).tests).toEqual([]);
  });
});

describe("reading Vitest's report", () => {
  it("lists failures with the path from src, and a file that never ran its tests", () => {
    const { ran, tests } = fromVitest({
      testResults: [
        {
          name: "/home/runner/work/Jane/Jane/src/lib/a.test.ts",
          status: "failed",
          assertionResults: [
            { fullName: "a works", status: "passed" },
            { fullName: "a breaks", status: "failed" },
            { fullName: "a later", status: "pending" },
          ],
        },
        {
          name: "/home/runner/work/Jane/Jane/src/lib/b.test.ts",
          status: "failed",
          assertionResults: [],
        },
      ],
    });
    expect(ran).toBe(2);
    expect(tests.map((t) => t.id)).toEqual(["src/lib/a.test.ts › a breaks", "src/lib/b.test.ts"]);
  });
});

describe("adding up the runs", () => {
  it("counts a retry's save as hidden, not clean", () => {
    const list = flakeList(
      [run({ run: 1, tests: [flaky("t")] }), run({ run: 2 }), run({ run: 3 })],
      NOW,
    );
    expect(list.main).toEqual({ runs: 3, cleanFirstTry: 2 });
    expect(list.hiddenFailures).toBe(1);
    expect(list.flaky[0]).toMatchObject({ id: "t", hidden: 1, stayedRed: 0, onMain: 1 });
  });

  it("counts a failure a job re-run saved as hidden", () => {
    const list = flakeList(
      [run({ run: 1, attempt: 1, tests: [red("t")] }), run({ run: 1, attempt: 2, tests: [] })],
      NOW,
    );
    expect(list.flaky[0]).toMatchObject({ hidden: 1, stayedRed: 0 });
    expect(list.main).toEqual({ runs: 1, cleanFirstTry: 0 });
  });

  it("keeps a test red when the re-run failed it too", () => {
    const list = flakeList(
      [
        run({ run: 1, attempt: 1, tests: [red("t")] }),
        run({ run: 1, attempt: 2, tests: [red("t")] }),
      ],
      NOW,
    );
    expect(list.flaky[0]).toMatchObject({ hidden: 0, stayedRed: 1, onMain: 1 });
  });

  it("doesn't call a run with no reports clean", () => {
    const list = flakeList([run({ run: 1, ran: 0 }), run({ run: 2 })], NOW);
    expect(list.main).toEqual({ runs: 1, cleanFirstTry: 1 });
  });

  it("doesn't take a later attempt with no reports as the test passing", () => {
    const list = flakeList(
      [
        run({ run: 1, attempt: 1, tests: [red("t")] }),
        run({ run: 1, attempt: 2, ran: 0, tests: [] }),
      ],
      NOW,
    );
    expect(list.flaky[0]).toMatchObject({ hidden: 0, stayedRed: 1 });
  });

  it("counts the nightly phone runs apart from CI on main", () => {
    const list = flakeList(
      [run({ run: 1, workflow: "E2E on a phone", tests: [flaky("t")] }), run({ run: 2 })],
      NOW,
    );
    expect(list.phone).toEqual({ runs: 1, cleanFirstTry: 0 });
    expect(list.main).toEqual({ runs: 1, cleanFirstTry: 1 });
  });

  it("leaves out a test that failed every try on one PR: that's usually the PR", () => {
    const list = flakeList([run({ branch: "feature", tests: [red("t")] })], NOW);
    expect(list.flaky).toEqual([]);
    expect(list.pr).toEqual({ runs: 1, cleanFirstTry: 0 });
  });

  it("keeps a test that passed on a retry on a PR", () => {
    const list = flakeList([run({ branch: "feature", tests: [flaky("t")] })], NOW);
    expect(list.flaky).toHaveLength(1);
  });

  it("reads only the window", () => {
    const old = run({ at: "2026-10-01T00:00:00Z", tests: [flaky("t")] });
    expect(flakeList([old], NOW).flaky).toEqual([]);
  });

  it("counts jobs that failed before any test, by where", () => {
    const list = flakeList(
      [
        run({ run: 1, jobsFailed: ["End-to-end build"] }),
        run({ run: 2, branch: "feature", jobsFailed: ["End-to-end build"] }),
      ],
      NOW,
    );
    expect(list.jobs).toEqual([{ name: "End-to-end build", main: 1, pr: 1 }]);
  });

  it("puts what hurts most first", () => {
    const list = flakeList(
      [
        run({ run: 1, tests: [flaky("twice"), flaky("once")] }),
        run({ run: 2, tests: [flaky("twice")] }),
      ],
      NOW,
    );
    expect(list.flaky.map((r: { id: string }) => r.id)).toEqual(["twice", "once"]);
  });
});

describe("the page sessions read", () => {
  it("shows the numbers and links each test's last run", () => {
    const text = renderFlakes(flakeList([run({ tests: [flaky("a | b")] })], NOW), "o/r", NOW);
    expect(text).toContain("Main runs clean on the first try: 0 of 1 (0%)");
    expect(text).toContain("First-try failures a retry or re-run hid: 1");
    expect(text).toContain("a \\| b");
    expect(text).toContain("https://github.com/o/r/actions/runs/1");
  });

  it("puts a failed nightly phone run first, until a later one passes", () => {
    const phone = (run: number, at: string, conclusion: string) =>
      ({ run, at, conclusion, workflow: "E2E on a phone" }) as Record<string, unknown>;
    const page = (records: Record<string, unknown>[]) =>
      renderFlakes(
        flakeList(
          records.map((r) => ({ ...run(), ...r })),
          NOW,
        ),
        "o/r",
        NOW,
      );
    const failed = phone(7, "2026-11-02T07:23:00Z", "failure");
    expect(page([failed])).toContain("nightly phone run failed on 2026-11-02");
    expect(page([failed])).toContain("https://github.com/o/r/actions/runs/7");
    expect(page([failed, phone(8, "2026-11-03T07:23:00Z", "success")])).not.toContain(
      "phone run failed",
    );
  });

  it("says so when there's nothing", () => {
    const text = renderFlakes(flakeList([], NOW), "o/r", NOW);
    expect(text).toContain("no runs");
    expect(text).toContain("None.");
  });
});

describe("what's kept", () => {
  it("drops records past the keep window, and caps a very bad run", () => {
    expect(keepRecent([run({ at: "2026-09-01T00:00:00Z" }), run()], NOW)).toHaveLength(1);
    const many = Array.from({ length: 500 }, (_, i) => red(`t${i}`));
    expect(recordOf(run(), [{ ran: 500, tests: many }]).tests).toHaveLength(200);
  });

  it("reads back what it wrote", () => {
    expect(parseRecords(`${JSON.stringify(run())}\n`)).toEqual([run()]);
  });
});
