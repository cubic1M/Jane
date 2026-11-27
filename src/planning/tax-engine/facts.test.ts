import { describe, expect, it } from "vitest";
import { TAX_FACT_PRECEDENCE, TAX_FACT_SPECS, taxFactSpec } from "@/config/tax-facts";
import { fact, mergeFacts, type StoredFact, type TaxHousehold } from "./facts";

let tick = 0;
const row = (over: Partial<StoredFact> & { origin: string; v: unknown }): StoredFact => ({
  key: "filing.status",
  memberKey: "self",
  value: { v: over.v },
  status: "known",
  sourceRef: null,
  confidence: 100,
  asOf: "2026-06-01",
  recordedAt: new Date(Date.UTC(2026, 5, 1, 0, 0, ++tick)),
  ...over,
});

const household = (rows: StoredFact[]): TaxHousehold => ({
  userId: "u",
  taxYear: 2026,
  today: "2026-11-27",
  facts: mergeFacts(rows),
  members: [],
});

describe("the household fact record's merge rule", () => {
  it("takes the first current row in the precedence order", () => {
    const origins = [...TAX_FACT_PRECEDENCE].reverse();
    // Added weakest first: whichever is added, the strongest present one wins.
    for (let n = 1; n <= origins.length; n += 1) {
      const present = origins.slice(0, n);
      const strongest = present[present.length - 1];
      const h = household(present.map((origin) => row({ origin, v: `from ${origin}` })));
      expect(fact(h, "filing.status").value).toBe(`from ${strongest}`);
      expect(fact(h, "filing.status").origin).toBe(strongest);
    }
  });

  it("keeps every disagreeing current row as a conflict, none silently dropped", () => {
    const h = household([
      row({ origin: "legacy", v: "married_joint", asOf: "2026-03-01" }),
      row({ origin: "answer", v: "single" }),
      row({ origin: "document", v: "head_of_household", asOf: "2026-04-01" }),
      row({ origin: "connector", v: "single" }),
    ]);
    const f = fact<string>(h, "filing.status");
    expect(f.value).toBe("single");
    expect(f.conflicts).toEqual([
      { value: "head_of_household", origin: "document", asOf: "2026-04-01" },
      { value: "married_joint", origin: "legacy", asOf: "2026-03-01" },
    ]);
  });

  it("keeps each dated row that disagrees, even from one origin", () => {
    const h = household([
      row({ origin: "answer", v: "single" }),
      row({ origin: "document", v: "married_joint", asOf: "2026-02-01" }),
      row({ origin: "document", v: "married_joint", asOf: "2026-03-01" }),
    ]);
    expect(fact(h, "filing.status").conflicts.map((c) => c.asOf)).toEqual([
      "2026-03-01",
      "2026-02-01",
    ]);
  });

  it("takes the newest of one origin's rows, by the person's day then the write", () => {
    const newest = household([
      row({ origin: "answer", v: "single", asOf: "2026-05-01" }),
      row({ origin: "answer", v: "married_joint", asOf: "2026-07-01" }),
    ]);
    expect(fact(newest, "filing.status").value).toBe("married_joint");
    const sameDay = household([
      row({ origin: "answer", v: "single" }),
      row({ origin: "answer", v: "head_of_household" }),
    ]);
    expect(fact(sameDay, "filing.status").value).toBe("head_of_household");
    expect(fact(sameDay, "filing.status").conflicts).toHaveLength(1);
  });

  it("ignores a superseded row: it is history, not a current value", () => {
    const h = household([
      row({ origin: "answer", v: "single", supersededAt: new Date("2026-06-02T00:00:00Z") }),
      row({ origin: "legacy", v: "married_joint" }),
    ]);
    expect(fact(h, "filing.status")).toMatchObject({ value: "married_joint", origin: "legacy" });
    expect(fact(h, "filing.status").conflicts).toEqual([]);
  });

  it("says unknown when there is no row, and never invents a value", () => {
    const h = household([row({ origin: "answer", v: "single" })]);
    expect(fact(h, "residency.status")).toMatchObject({
      value: null,
      status: "unknown",
      origin: null,
      confidence: 0,
      asOf: null,
      conflicts: [],
    });
    // Another member's fact is another fact.
    expect(fact(h, "filing.status", "spouse").status).toBe("unknown");
  });

  it("keeps a fact per member", () => {
    const h = household([
      row({ key: "member.months_lived_with_you", memberKey: "child:a", origin: "answer", v: 12 }),
      row({ key: "member.months_lived_with_you", memberKey: "child:b", origin: "answer", v: 5 }),
    ]);
    expect(fact(h, "member.months_lived_with_you", "child:a").value).toBe(12);
    expect(fact(h, "member.months_lived_with_you", "child:b").value).toBe(5);
  });

  it("reports an inferred row as inferred and a known one as known", () => {
    const h = household([
      row({ key: "person.birth_date", origin: "legacy", status: "inferred", v: "1999/2000" }),
    ]);
    expect(fact(h, "person.birth_date")).toMatchObject({ status: "inferred", value: "1999/2000" });
  });
});

describe("the fact specs", () => {
  it("name each key once, and never hold a number that identifies a person", () => {
    const keys = TAX_FACT_SPECS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((k) => /\b(ssn|itin|ein|account_number)\b$/.test(k))).toEqual([]);
    // The only Social Security fact is the yes / no / unknown flag.
    expect(taxFactSpec("person.ssn_valid_for_work").choices).toEqual(["yes", "no", "unknown"]);
  });

  it("marks a fact that is not year-scoped with year 0, and a birth date is one", () => {
    expect(taxFactSpec("person.birth_date").yearScoped).toBe(false);
    expect(taxFactSpec("filing.status").yearScoped).toBe(true);
  });
});
