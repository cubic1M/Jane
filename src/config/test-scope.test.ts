import { describe, expect, it } from "vitest";
import {
  changedSpecs,
  docsNamedIn,
  MAIN_ONLY_TESTS,
  shardsFor,
  testScope,
  testsThatReadDocs,
  vitestArgs,
} from "../../scripts/test-scope-core.mjs";

const pr = (changedPaths: string[], over: Record<string, unknown> = {}) =>
  testScope({ changedPaths, event: "pull_request", onMain: false, ...over } as never).mode;

describe("how much a run tests", () => {
  it("runs only what a PR's diff reaches", () => {
    expect(pr(["src/detection/rules/fees.ts", "src/detection/rules/fees.test.ts"])).toBe("changed");
    expect(pr(["src/components/card.tsx"])).toBe("changed");
  });

  it.each(["push", "merge_group", "workflow_dispatch", "schedule"])(
    "runs everything on %s, whatever changed",
    (event) => {
      expect(pr(["README.md"], { event })).toBe("full");
    },
  );

  it("runs everything on main", () => {
    expect(pr(["README.md"], { onMain: true })).toBe("full");
  });

  it.each(["full-tests", "e2e"])("runs everything with the label %s", (label) => {
    expect(pr(["src/components/card.tsx"], { labels: [label] })).toBe("full");
  });

  it("ignores other labels", () => {
    expect(pr(["src/components/card.tsx"], { labels: ["bug"] })).toBe("changed");
  });

  it.each([
    "package.json",
    "package-lock.json",
    "prisma/schema.prisma",
    "prisma/migrations/20270424000000_x/migration.sql",
    "vitest.config.mts",
    "tsconfig.json",
    "next.config.ts",
    "eslint.config.mjs",
    ".env.example",
    ".github/workflows/ci.yml",
    "scripts/rls-protect.mjs",
    "src/test-setup/no-anthropic.ts",
    "src/config/detection.ts",
    "src/lib/db.ts",
    "src/lib/db-scoped.ts",
    "src/lib/rls-pg.ts",
    "src/security/access-proof/routes.ts",
    "src/lib/guardrails.ts",
    "src/lib/advice-mode.ts",
    "src/lib/session.ts",
    "src/auth.ts",
    "src/app/api/auth/[...nextauth]/route.ts",
    "src/proxy.ts",
    "src/lib/import/background.ts",
    "src/app/import/import-form.tsx",
  ])("runs everything when %s changes", (path) => {
    expect(pr(["src/components/card.tsx", path])).toBe("full");
  });

  it("runs everything when it can't see what changed, rather than skip", () => {
    expect(pr([])).toBe("full");
  });
});

describe("what counts as docs only", () => {
  it("skips the tests for docs no test reads", () => {
    expect(pr(["docs/architecture.md", "README.md"])).toBe("docs");
  });

  it("doesn't skip for a doc a test reads and compares", () => {
    const docsReadByTests = ["docs/backtests/events.md"];
    expect(pr(["docs/backtests/events.md"], { docsReadByTests })).toBe("changed");
  });

  it("doesn't count a data file in docs/ as a doc", () => {
    expect(pr(["docs/chat-scenarios.json"])).toBe("changed");
  });

  it("doesn't skip when code changes along with the doc", () => {
    expect(pr(["docs/architecture.md", "src/components/card.tsx"])).toBe("changed");
  });

  it("doesn't count this test's own examples as reading a doc", () => {
    expect(
      testsThatReadDocs([
        "config/test-scope.test.ts",
        "planning/event-evidence.test.ts",
        "lib/home.tsx",
      ]),
    ).toEqual(["planning/event-evidence.test.ts"]);
  });

  it("finds the docs a test names", () => {
    expect(docsNamedIn('read("docs/backtests/events.md"), `docs/ci.md`')).toEqual([
      "docs/backtests/events.md",
      "docs/ci.md",
    ]);
  });
});

describe("how many shards it's worth", () => {
  it("uses every shard for a full run and none for docs", () => {
    expect(shardsFor("full", 0)).toBe(4);
    expect(shardsFor("docs", 0)).toBe(0);
  });

  it("scales with the integration files the diff reaches", () => {
    expect(shardsFor("changed", 0)).toBe(1);
    expect(shardsFor("changed", 15)).toBe(1);
    expect(shardsFor("changed", 16)).toBe(2);
    expect(shardsFor("changed", 60)).toBe(2);
    expect(shardsFor("changed", 61)).toBe(4);
  });
});

describe("what the unit jobs are told to run", () => {
  const slow = `--exclude ${MAIN_ONLY_TESTS[0]}`;

  it("runs what the diff reaches on a PR, without the main-only tests", () => {
    expect(vitestArgs("changed", { event: "pull_request" })).toBe(
      `--changed=HEAD^1 --passWithNoTests ${slow}`,
    );
  });

  it("leaves the main-only tests out of a PR's full run too", () => {
    expect(vitestArgs("full", { event: "pull_request" })).toBe(slow);
  });

  it("leaves nothing out on main, or with a full-run label", () => {
    expect(vitestArgs("full", { event: "push" })).toBe("");
    expect(vitestArgs("full", { event: "workflow_dispatch" })).toBe("");
    expect(vitestArgs("full", { event: "pull_request", labels: ["full-tests"] } as never)).toBe("");
  });
});

describe("the end-to-end specs a PR runs beyond the critical ones", () => {
  it("are the spec files it changes, and not their helpers", () => {
    expect(
      changedSpecs(["e2e/hub.spec.ts", "e2e/waits.ts", "src/components/card.tsx", "docs/ci.md"]),
    ).toEqual(["e2e/hub.spec.ts"]);
  });
});
