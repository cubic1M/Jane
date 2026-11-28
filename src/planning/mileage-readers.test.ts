import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NoTaxParamsError, pendingGroups } from "@/config/tax-params";
import { businessMileageCentsOn, mileageRateNote, undatedMileageCentsIn } from "@/config/tax-rates";
import { TAX_DETECTORS } from "@/detectors/taxes";
import { runDetectors } from "@/detectors";
import { STUDENT_WITHHOLDING_DETECTORS, withheldPerCheck } from "@/detectors/student-withholding";
import type { SelfEmployedView } from "@/lib/self-employed";
import { businessReply } from "@/lib/jane-agent/business-message";
import { selfEmployedReply } from "@/lib/jane-agent/tax-replies";
import { noParamsText } from "@/lib/tax-estimate-state";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { mileageDeduction, mileageFigure } from "./self-employed";

// Tax T32b, the proof that nothing can reach a number in an awaited group. 2027 is the year whose
// IRS mileage rate is not published yet: every reader below runs, for a 2027 date, the very path it
// runs on January 1, 2027.

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
    // In January to April the page's year is still last year's, but the miles are saved to the
    // calendar year (saveMiles), so the quote names that year: the 2027 sentence, not 2026's rate.
    const january = selfEmployedReply(
      { kind: "tax", ask: "miles", miles: 1_000 },
      view2026,
      "2027-01-15",
    );
    expect(january.body).toContain(W_N_2027);
    expect(january.body).not.toMatch(mileageCents);
    // And December is still the 2026 rate.
    const december = selfEmployedReply(
      { kind: "tax", ask: "miles", miles: 1_000 },
      view2026,
      "2026-12-10",
    );
    expect(december.body).toContain("At the 2026 rate that's about $725");
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

// The second awaited group of 2027 (Pub. 15-T). Its one reader, withheldPerCheck, serves two cards;
// for a 2027 date each is held back (no number, no zero, no 2026 figure) and a year with no figures
// at all is still told apart from an awaited group.
describe("every reader of the withholding group, for 2027", () => {
  const tx = (date: string, amountCents: number, description: string, pfc: string | null) => ({
    date,
    amountCents,
    description,
    pfc,
    accountId: "checking",
  });
  const every = (from: string, to: string, days: number) => {
    const out: string[] = [];
    for (let t = Date.parse(from); t <= Date.parse(to); t += days * 86_400_000)
      out.push(new Date(t).toISOString().slice(0, 10));
    return out;
  };
  const input = (year: number): ProfileInput => {
    const today = `${year}-11-17`;
    const groceries = every(`${year}-09-01`, today, 14).map((d) =>
      tx(d, 6_000, "SAFEWAY #1234 MOUNTAIN VIEW CA", "FOOD_AND_DRINK_GROCERIES"),
    );
    const job = (name: string, net: number, from: string) =>
      every(from, today, 14).map((d) => tx(d, -net, `${name} PAYROLL`, "INCOME_SALARY"));
    return {
      today,
      transactions: [
        ...groceries,
        ...job("ACME CORP", 90_000, `${year}-09-04`),
        ...job("BLUE BOTTLE", 70_000, `${year}-09-05`),
      ],
      accounts: [
        { id: "checking", type: "depository", subtype: "checking", balanceCents: 300_000 },
      ],
      liabilities: [],
      told: {},
    };
  };
  const topics = ["withholding_part_year", "withholding_two_jobs"];
  const cards = (year: number, onError: (e: unknown) => void = () => {}) => {
    const data = input(year);
    return runDetectors(
      { profile: buildProfile(data), data },
      STUDENT_WITHHOLDING_DETECTORS,
      (_, e) => onError(e),
    );
  };

  it("1 withheldPerCheck: a 2027 wage year throws the group error, 2025 and 2026 still price", () => {
    for (const status of ["single", "married_joint"] as const) {
      expect(() => withheldPerCheck(100_000, 24, status, 2027)).toThrow(
        expect.objectContaining({ name: "NoTaxParamsError", year: 2027, group: "withholding" }),
      );
    }
    expect(withheldPerCheck(100_000, 24, "single", 2026)).toBeGreaterThan(0);
    expect(withheldPerCheck(100_000, 24, "single", 2025)).toBeGreaterThan(0);
    // Only the awaited group is the withholding one: a year with no figures names no group.
    expect(() => withheldPerCheck(100_000, 24, "single", 2028)).toThrow(NoTaxParamsError);
    expect(() => withheldPerCheck(100_000, 24, "single", 2028)).not.toThrow(
      expect.objectContaining({ group: "withholding" }),
    );
  });

  it("2 the two-jobs card: shown for 2026, held back for a 2027 date with no figure and no bug report", () => {
    expect(cards(2026).map((c) => c.topic)).toContain("withholding_two_jobs");
    const errors: unknown[] = [];
    const out = cards(2027, (e) => errors.push(e));
    expect(out.map((c) => c.topic).filter((t) => topics.includes(t))).toEqual([]);
    expect(errors).toEqual([]);
    const data = input(2027);
    const twoJobs = STUDENT_WITHHOLDING_DETECTORS.find((d) => d.topic === "withholding_two_jobs")!;
    expect(() => twoJobs.detect({ profile: buildProfile(data), data })).toThrow(
      expect.objectContaining({ name: "NoTaxParamsError", year: 2027, group: "withholding" }),
    );
  });

  it("3 the part-year card: held back for a 2027 wage year (it reads the same function)", () => {
    const partYear = STUDENT_WITHHOLDING_DETECTORS.find(
      (d) => d.topic === "withholding_part_year",
    )!;
    const pay = (year: number) =>
      every(`${year}-08-01`, `${year}-11-17`, 15).map((d) =>
        tx(d, -400_000, "STANFORD UNIVERSITY PAYROLL", "INCOME_SALARY"),
      );
    const data = (year: number): ProfileInput => ({
      ...input(year),
      transactions: [
        ...every(`${year}-07-01`, `${year}-11-17`, 14).map((d) =>
          tx(d, 6_000, "SAFEWAY #1234 MOUNTAIN VIEW CA", "FOOD_AND_DRINK_GROCERIES"),
        ),
        ...pay(year),
      ],
    });
    const d2026 = data(2026);
    expect(partYear.detect({ profile: buildProfile(d2026), data: d2026 })).not.toBeNull();
    const d2027 = data(2027);
    expect(() => partYear.detect({ profile: buildProfile(d2027), data: d2027 })).toThrow(
      expect.objectContaining({ name: "NoTaxParamsError", year: 2027, group: "withholding" }),
    );
    const errors: unknown[] = [];
    expect(
      runDetectors({ profile: buildProfile(d2027), data: d2027 }, [partYear], (_, e) =>
        errors.push(e),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
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
    expect(keys.sort()).toEqual(["mileage", "withholding"]);
    // Each awaited group has exactly one reader outside the params folder. withholding is read
    // only by withheldPerCheck (src/detectors/student-withholding.ts), whose 2027 behaviour is
    // proved where 2027 is switched on.
    const readerOf: Record<string, string> = {
      mileage: "config/tax-rates.ts",
      withholding: "detectors/student-withholding.ts",
    };
    for (const key of keys) {
      const readers = mentioning(new RegExp(`\\b${key}\\.value\\b`)).filter(
        (path) => !path.startsWith("config/tax-params/"),
      );
      expect(readers, `readers of ${key}.value`).toEqual([readerOf[key]]);
    }
  });
});
