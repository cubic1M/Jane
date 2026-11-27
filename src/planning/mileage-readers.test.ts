import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { NoTaxParamsError, pendingGroups } from "@/config/tax-params";
import { businessMileageCentsOn, mileageRateNote, undatedMileageCentsIn } from "@/config/tax-rates";
import { TAX_DETECTORS } from "@/detectors/taxes";
import { runDetectors } from "@/detectors";
import type { SelfEmployedView } from "@/lib/self-employed";
import { businessReply } from "@/lib/jane-agent/business-message";
import { selfEmployedReply } from "@/lib/jane-agent/tax-replies";
import { noParamsText } from "@/lib/tax-estimate-state";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { mileageDeduction, mileageFigure } from "./self-employed";

// Tax T32b, the proof that nothing can reach a number in an awaited group. 2027 is the year whose
// IRS mileage rate is not published yet; until the year is switched on (the next PR) the
// year-keyed reader is pointed at its draft file here, so every reader below runs the very path it
// will run on January 1, 2027.
vi.mock("@/config/tax-params", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/tax-params")>();
  const federalParams = (year: number) =>
    year === 2027 ? actual.draftParams(2027) : actual.federalParams(year);
  return { ...actual, federalParams };
});

const W_N_2027 =
  "Jane doesn't have the IRS's 2027 mileage rate yet, so it hasn't counted those miles.";

// A freelancer's view as loadSelfEmployed builds it for 2027 (the loader is run against a database
// in src/lib/tax-year-2027-surfaces.integration.test.ts).
const view2027 = (miles: number): SelfEmployedView =>
  ({
    year: 2027,
    active: true,
    advice: false,
    freelanceInCents: 0,
    businessCents: 0,
    homeOffice: { sqft: null, deductionCents: 0 },
    mileage: { miles, ...mileageFigure(miles, 2027) },
  }) as unknown as SelfEmployedView;

const mileageCents = /\$\s?\d|\d\s*cents/;

describe("the W-N sentence for an awaited mileage rate", () => {
  it("names the year and what was left out, and is the text NoTaxParamsError.group gives", () => {
    expect(noParamsText(2027, "mileage")).toBe(W_N_2027);
    expect(noParamsText(2027)).toBe(
      "Jane doesn't have the IRS figures for 2027 yet, so it isn't estimating that year.",
    );
    expect(noParamsText(2028, "other")).toBe(
      "Jane doesn't have the IRS's 2028 other figures yet, so it hasn't counted them.",
    );
  });
});

describe("every reader of the mileage group, for 2027", () => {
  it("1 businessMileageCentsOn: a 2027 trip date throws the group error", () => {
    for (const day of ["2027-01-01", "2027-06-30", "2027-07-01", "2027-12-31"]) {
      expect(() => businessMileageCentsOn(day)).toThrow(
        expect.objectContaining({ name: "NoTaxParamsError", year: 2027, group: "mileage" }),
      );
    }
    // 2026 and 2025 are unchanged, each its own year's rate.
    expect(businessMileageCentsOn("2026-12-31")).toBe(76);
    expect(businessMileageCentsOn("2025-12-31")).toBe(70);
  });

  it("2 undatedMileageCentsIn and mileageRateNote (the rate for undated miles and its note)", () => {
    expect(() => undatedMileageCentsIn(2027)).toThrow(NoTaxParamsError);
    expect(() => mileageRateNote(2027)).toThrow(NoTaxParamsError);
    expect(undatedMileageCentsIn(2026)).toBe(72.5);
    expect(undatedMileageCentsIn(2025)).toBe(70);
  });

  it("3 mileageDeduction (the self-employed planner's deduction): throws, dated or not", () => {
    expect(() => mileageDeduction(1_000, 2027)).toThrow(NoTaxParamsError);
    expect(() => mileageDeduction(1_000, 2027, "2027-03-01")).toThrow(NoTaxParamsError);
    // No miles, nothing to price, nothing awaited.
    expect(mileageDeduction(null, 2027)).toBe(0);
    expect(mileageDeduction(0, 2027)).toBe(0);
  });

  it("4 mileageFigure (what the estimate, the audit pack, the page and the chat read): W-N, no figure", () => {
    expect(mileageFigure(1_000, 2027)).toEqual({ deductionCents: 0, awaited: W_N_2027 });
    expect(mileageFigure(1_000, 2027, "2027-08-01")).toEqual({
      deductionCents: 0,
      awaited: W_N_2027,
    });
    expect(mileageFigure(null, 2027)).toEqual({ deductionCents: 0, awaited: null });
    expect(mileageFigure(1_000, 2026)).toEqual({ deductionCents: 72_500, awaited: null });
    // Only the awaited group is caught: a year with no figures at all still throws.
    expect(() => mileageFigure(1_000, 2028)).toThrow(NoTaxParamsError);
    expect(() => mileageFigure(1_000, 2028)).not.toThrow(
      expect.objectContaining({ group: "mileage" }),
    );
  });

  it("5 the chat's miles answers (selfEmployedReply): the W-N line and no dollar figure", () => {
    const logged = selfEmployedReply(
      { kind: "tax", ask: "miles", miles: null },
      view2027(1_200),
      "2027-03-01",
    );
    expect(logged.body).toContain(W_N_2027);
    expect(logged.body).toContain("1,200 business miles");
    expect(logged.body).not.toMatch(mileageCents);
    const adding = selfEmployedReply(
      { kind: "tax", ask: "miles", miles: 40 },
      view2027(0),
      "2027-03-01",
    );
    expect(adding.body).toContain(W_N_2027);
    expect(adding.body).not.toMatch(mileageCents);
    // The same question in 2026 still gives the figure, now with the view's own year.
    const view2026 = {
      ...view2027(0),
      year: 2026,
      mileage: { miles: 0, ...mileageFigure(0, 2026) },
    };
    const priced = selfEmployedReply(
      { kind: "tax", ask: "miles", miles: 1_000 },
      view2026,
      "2026-03-01",
    );
    expect(priced.body).toContain("At the 2026 rate that's about $725");
  });

  it("6 the business-taxes chat message: the miles line carries W-N, no deduction", () => {
    const message = businessReply({
      year: 2027,
      advice: false,
      structure: {
        profitCents: 5_000_000,
        sole: { qbiLimited: true, taxCents: 1_000_000 },
        sCorp: { worthIt: false },
      },
      homeOffice: { sqft: null, deductionCents: 0 },
      mileage: { miles: 500, ...mileageFigure(500, 2027) },
    } as unknown as Parameters<typeof businessReply>[0]);
    expect(message.body).toContain(`Business miles this year: 500. ${W_N_2027}`);
    expect(message.body).not.toMatch(/Business miles this year: 500, a/);
  });

  it("7 the vehicle-deduction card: held back in 2027 (the detector throws the group error), priced in 2026", () => {
    const vehicle = TAX_DETECTORS.filter((d) => d.topic === "vehicle_deduction");
    expect(vehicle).toHaveLength(1);
    const sample = inputFor("owner");
    const in2027 = {
      ...sample,
      today: "2027-10-17",
      transactions: sample.transactions.map((t) => ({
        ...t,
        date: t.date.replace(/^2026/, "2027"),
      })),
    };
    const data = in2027;
    const errors: unknown[] = [];
    const out = runDetectors({ profile: buildProfile(data), data }, vehicle, (_, e) =>
      errors.push(e),
    );
    expect(out).toEqual([]);
    // Held back as the year's own law is missing: not reported as a bug.
    expect(errors).toEqual([]);
    expect(() => vehicle[0]!.detect({ profile: buildProfile(data), data })).toThrow(
      expect.objectContaining({ name: "NoTaxParamsError", year: 2027, group: "mileage" }),
    );
    const now = inputFor("owner");
    const card = runDetectors({ profile: buildProfile(now), data: now }, vehicle);
    expect(card).toHaveLength(1);
    expect(card[0]!.why).toContain("Miles with no date are counted at 72.5 cents");
  });
});

// The enumeration is only a proof if it is complete: a new reader of the group is a failing test,
// not a silent gap. Every source file that touches the mileage group or one of its readers is
// listed; the list changes only with a reader added here and in the tests above.
describe("no other reader of an awaited group exists", () => {
  const root = join(process.cwd(), "src");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.|\.golden\./.test(name) ? [path] : [];
    });
  const source = files(root).map((path) => ({
    path: path.slice(root.length + 1),
    text: readFileSync(path, "utf8"),
  }));
  const mentioning = (re: RegExp) =>
    source
      .filter((f) => re.test(f.text))
      .map((f) => f.path)
      .sort();

  it("only src/config/tax-rates.ts reads the group's value (the year files and the bench probes name it)", () => {
    expect(mentioning(/\bmileage\.value\b/)).toEqual(["config/tax-rates.ts"]);
  });

  it("only the shim file defines the 2026 constants, and no other file imports them", () => {
    expect(mentioning(/\b(?:MILEAGE_RATE_CENTS|MILEAGE_RATE_NOTE|MILEAGE_PERIODS)\b/)).toEqual([
      "config/tax-rates.ts",
    ]);
  });

  it("the year-keyed readers are used by exactly these files", () => {
    expect(
      mentioning(/\b(?:businessMileageCentsOn|undatedMileageCentsIn|mileageRateNote)\b/),
    ).toEqual([
      "app/taxes/self-employed/page.tsx",
      "config/tax-rates.ts",
      "detectors/taxes.ts",
      "planning/self-employed.ts",
    ]);
    expect(mentioning(/\bmileage(?:Deduction|Figure)\b/)).toEqual([
      "lib/audit-records.ts",
      "lib/jane-agent/tax-replies.ts",
      "lib/self-employed.ts",
      "lib/tax-estimate.ts",
      "planning/self-employed.ts",
    ]);
  });

  it("no awaited group of any year is read by `<group>.value` outside the year-keyed accessors", () => {
    const keys = [
      ...new Set(
        pendingGroups()
          .filter((g) => g.status === "awaited")
          .map((g) => g.key),
      ),
    ];
    expect(keys).toContain("mileage");
    for (const key of keys) {
      const readers = mentioning(new RegExp(`\\b${key}\\.value\\b`)).filter(
        (path) => !path.startsWith("config/tax-params/"),
      );
      expect(readers, `readers of ${key}.value`).toEqual(["config/tax-rates.ts"]);
    }
  });
});
