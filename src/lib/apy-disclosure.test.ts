import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APY_FEES, APY_MAY_CHANGE, apyDisclosures, apyHeadline } from "./apy-disclosure";

// Reg DD's advertising rules for a savings rate (12 CFR 1030.8; connectors roadmap round 13).

describe("the APY wording", () => {
  it("names the rate in full, with the day it was checked", () => {
    expect(apyHeadline(400, "2026-11-05")).toBe(
      "Annual Percentage Yield (APY) 4.00% as of 2026-11-05",
    );
    expect(apyHeadline(5, "2026-11-05")).toBe(
      "Annual Percentage Yield (APY) 0.05% as of 2026-11-05",
    );
  });

  it("goes with the minimum to earn it, that it may change, and that fees could cut it", () => {
    expect(apyDisclosures(100_000)).toEqual([
      "Minimum to earn the APY: $1,000.",
      "Rate may change after the account is opened.",
      "Fees could reduce the earnings on the account.",
    ]);
    expect(apyDisclosures(0)[0]).toBe("No minimum balance to earn the APY.");
  });

  it("is the only way a savings rate is shown on a page", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : [path];
      });
    const pages = files("src")
      .filter((path) => /\.tsx$/.test(path) && !/\.test\.tsx$/.test(path))
      // The team's own list of options (/admin/options) advertises nothing to anyone.
      .filter((path) => !path.includes("/admin/"))
      .filter((path) => readFileSync(path, "utf8").includes("apyBps"));
    for (const page of pages) {
      const source = readFileSync(page, "utf8");
      // A rate worked out by hand ("apyBps / 100") is a rate shown without its disclosures.
      expect(source, page).not.toMatch(/apyBps\s*\/\s*100/);
      if (/apyBps\s*!==\s*null/.test(source)) {
        expect(source, page).toContain("apyHeadline");
        expect(source, page).toContain("apyDisclosures");
      }
    }
    expect(APY_MAY_CHANGE).toMatch(/may change/);
    expect(APY_FEES).toMatch(/Fees could reduce/);
  });
});
