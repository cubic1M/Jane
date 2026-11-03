import { describe, expect, it } from "vitest";
import {
  QUARANTINE,
  grepInvert,
  issueBody,
  quarantineList,
} from "../../scripts/quarantine-core.mjs";

const NOW = "2026-11-20T12:00:00Z";
const daysAgo = (days: number) => new Date(Date.parse(NOW) - days * 86400000).toISOString();
const ID = "[chromium] e2e/a.spec.ts › a flaky thing";

const flaked = (sha: string, days = 10, id = ID, branch = "main", last = "passed") => ({
  at: daysAgo(days),
  sha,
  branch,
  tests: [{ id, kind: "e2e", first: "failed", last }],
});
const onThreeCommits = (id = ID) => [flaked("a", 10, id), flaked("b", 9, id), flaked("c", 8, id)];
const ids = (list: { id: string }[]) => list.map((entry) => entry.id);

describe("what gets quarantined", () => {
  it("a test that flaked on three main commits, and for a limited time", () => {
    const [entry] = quarantineList(onThreeCommits(), [], NOW);
    expect(entry.id).toBe(ID);
    expect(entry.since).toBe(NOW);
    expect(Date.parse(entry.until) - Date.parse(NOW)).toBe(QUARANTINE.expiresAfterDays * 86400000);
  });

  it("not on one commit, however often", () => {
    const records = [flaked("a"), flaked("a"), flaked("a")];
    expect(quarantineList(records, [], NOW)).toEqual([]);
  });

  it("not from a PR's branch, where the PR may be the cause", () => {
    const records = ["a", "b", "c"].map((sha) => flaked(sha, 10, ID, "claude/x"));
    expect(quarantineList(records, [], NOW)).toEqual([]);
  });

  it("not when it failed every try: that's a real break", () => {
    const records = ["a", "b", "c"].map((sha) => flaked(sha, 10, ID, "main", "failed"));
    expect(quarantineList(records, [], NOW)).toEqual([]);
  });

  it("not a new test", () => {
    const records = [flaked("a", 3), flaked("b", 2), flaked("c", 1)];
    expect(quarantineList(records, [], NOW)).toEqual([]);
  });

  it.each([
    "[chromium] e2e/a.spec.ts › signs in @critical",
    "[chromium] e2e/a.spec.ts › one person can't see another person's rows",
    "[chromium] e2e/a.spec.ts › the guardrail refuses",
    "[chromium] e2e/a.spec.ts › safe to spend says why",
    "[chromium] e2e/legal.spec.ts › the Privacy Policy says it",
  ])("never %s", (id) => {
    expect(quarantineList(onThreeCommits(id), [], NOW)).toEqual([]);
  });

  it("holds no more than the limit, worst first", () => {
    const many = Array.from({ length: QUARANTINE.mostAtOnce + 3 }, (_, i) =>
      onThreeCommits(`[chromium] e2e/a.spec.ts › test ${i}`),
    ).flat();
    const worse = "[chromium] e2e/a.spec.ts › the worst";
    const records = [...many, ...onThreeCommits(worse), flaked("d", 7, worse)];
    const list = quarantineList(records, [], NOW);
    expect(list).toHaveLength(QUARANTINE.mostAtOnce);
    expect(list[0].id).toBe(worse);
  });
});

describe("how it ends", () => {
  it("keeps an entry until its date, without moving the date", () => {
    const entry = { id: ID, since: daysAgo(5), until: daysAgo(-9) };
    expect(quarantineList(onThreeCommits(), [entry], NOW)).toEqual([entry]);
  });

  it("blocks again once its time is up, even with old failures on record", () => {
    const entry = { id: ID, since: daysAgo(15), until: daysAgo(1) };
    expect(ids(quarantineList(onThreeCommits(), [entry], NOW))).toEqual([]);
  });
});

describe("what Playwright is told", () => {
  const entry = { id: ID, since: NOW, until: NOW };

  it("leaves out the title, with regex characters escaped", () => {
    const odd = { ...entry, id: "[chromium] e2e/a.spec.ts › costs $5 (a/b)?" };
    expect(grepInvert([odd])).toBe("costs \\$5 \\(a\\/b\\)\\?");
    expect("costs $5 (a/b)?").toMatch(new RegExp(grepInvert([odd])));
  });

  it("is empty with nothing quarantined", () => {
    expect(grepInvert([])).toBe("");
  });

  it("still runs it, so it can block, on a PR that changes its spec", () => {
    expect(grepInvert([entry], ["e2e/a.spec.ts"])).toBe("");
    expect(grepInvert([entry], ["e2e/b.spec.ts"])).toBe("a flaky thing");
  });

  it("names the date in the issue", () => {
    expect(issueBody({ id: ID, since: NOW, until: "2026-12-04T12:00:00Z" })).toContain(
      "2026-12-04",
    );
  });
});
