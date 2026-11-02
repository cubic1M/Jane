import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { LIFE_DETECTORS } from "./life";

// Spec step 264: life events and households.
const [lifeChecklist, householdSetup, payStopped] = LIFE_DETECTORS;
const run = (id: string, extras?: { householdMembers: number }) => {
  const data = { ...inputFor(id), extras };
  const ctx = { profile: buildProfile(data), data };
  return { life: lifeChecklist.detect(ctx), household: householdSetup.detect(ctx) };
};

describe("life event and household detectors", () => {
  it("sees the Reyes family's job change two months ago, as a guess", () => {
    const { life } = run("family", { householdMembers: 0 });
    expect(life?.title).toMatch(/new-job checklist/);
    expect(life?.why).toMatch(/Meridian Medical/);
    expect(life?.confidence.percent).toBeLessThanOrEqual(75);
    expect(life?.action.href).toBe("/life-events");
  });

  it("finds no event in lives where nothing changed", () => {
    for (const id of ["renter", "freelancer", "equity", "preretire", "retiree", "debt", "owner"]) {
      expect(run(id, { householdMembers: 0 }).life, id).toBeNull();
    }
  });

  // Night QA 10-30: "Childcare payments began on 2026-08-04", the uploaded statements' first
  // week: payments seen from the start were going on before, and the day read as code.
  it("sees a new child only when childcare starts well after the data does", () => {
    const sample = inputFor("renter");
    const day = (ago: number) =>
      new Date(Date.parse(`${sample.today}T00:00:00Z`) - ago * 86_400_000)
        .toISOString()
        .slice(0, 10);
    // Three months of uploaded statements: the data starts 85 days ago.
    const base = { ...sample, transactions: sample.transactions.filter((t) => t.date >= day(85)) };
    const care = (agos: number[]) =>
      agos.map((ago) => ({
        date: day(ago),
        amountCents: 185_000,
        description: "KINDERCARE LEARNING CTR",
        pfc: "GENERAL_SERVICES_CHILDCARE",
        accountId: base.transactions[0].accountId,
      }));
    const detect = (agos: number[]) => {
      const data = { ...base, transactions: [...base.transactions, ...care(agos)] };
      return lifeChecklist.detect({ profile: buildProfile(data), data });
    };
    const fresh = detect([40, 20, 1]);
    expect(fresh?.title).toMatch(/new-baby checklist/);
    expect(fresh?.short).toMatch(/^Childcare payments began on [A-Z][a-z]{2} \d{1,2}, \d{4}\.$/);
    // From the statements' first week on: nothing new about it.
    expect(detect([82, 52, 22])).toBeNull();
  });

  it("suggests a household only to more-than-one-person households not yet in one", () => {
    expect(run("family", { householdMembers: 0 }).household?.action.href).toBe("/household");
    expect(run("preretire", { householdMembers: 0 }).household).not.toBeNull();
    expect(run("family", { householdMembers: 1 }).household).toBeNull();
    expect(run("family").household).toBeNull();
    expect(run("renter", { householdMembers: 0 }).household).toBeNull();
  });
});

// Debugger 11-02: someone laid off in August got no word from Jane about it, however long after
// they uploaded: the late-paycheck change only looks at the last few days.
describe("pay that has stopped", () => {
  const TODAY = "2026-11-02";
  const every = (days: number, from: string, to: string) => {
    const out: string[] = [];
    for (let d = Date.parse(`${from}T00:00:00Z`); d <= Date.parse(`${to}T00:00:00Z`);) {
      out.push(new Date(d).toISOString().slice(0, 10));
      d += days * 86_400_000;
    }
    return out;
  };
  const made = (rows: { date: string; cents: number; pfc: string; description: string }[]) => {
    const sample = inputFor("renter");
    const accountId = sample.accounts.find((a) => a.type === "depository")!.id;
    const data = {
      ...sample,
      today: TODAY,
      transactions: rows.map((r, i) => ({
        id: `t${i}`,
        date: r.date,
        amountCents: r.cents,
        description: r.description,
        pfc: r.pfc,
        accountId,
      })),
    };
    return payStopped.detect({ profile: buildProfile(data), data });
  };
  const pay = (from: string, to: string, name = "ACME LOGISTICS INC PAYROLL") =>
    every(14, from, to).map((date) => ({
      date,
      cents: -264_018,
      pfc: "INCOME_SALARY",
      description: name,
    }));
  const benefits = every(7, "2026-09-08", "2026-10-27").map((date) => ({
    date,
    cents: -45_000,
    pfc: "INCOME_UNEMPLOYMENT",
    description: "CA EDD UI DIRECT DEP",
  }));
  const spending = every(7, "2026-02-01", "2026-10-30").map((date) => ({
    date,
    cents: 5_000,
    pfc: "FOOD_AND_DRINK_GROCERIES",
    description: "SAFEWAY",
  }));

  it("says so, with the day and what's coming in now", () => {
    const s = made([...pay("2026-02-06", "2026-08-07"), ...benefits, ...spending])!;
    expect(s.topic).toBe("pay_stopped");
    expect(s.why).toContain("Acme Logistics Inc");
    expect(s.why).toContain("Aug 7");
    expect(s.why).toMatch(/about \$2,100\.00 a month/);
    expect(s.worthKind).toBe("risk");
    // $2,640.18 every two weeks is about $5,720 a month; about $2,100 comes in now.
    expect(s.worthCents).toBeGreaterThan(350_000);
    expect(s.worthCents).toBeLessThan(380_000);
    // Ahead of a tip about a phone bill: this is the first thing to know.
    expect(s.rankCents).toBe(s.worthCents * 12);
    expect(s.confidence.percent).toBeGreaterThan(0);
    // It says what it can see, and doesn't say why: they may have left, retired or changed banks.
    expect(`${s.title} ${s.short} ${s.why}`).not.toMatch(/laid off|lost your job|fired/i);
  });

  it("says nothing when they're still being paid", () => {
    expect(made([...pay("2026-02-06", "2026-10-30"), ...spending])).toBeNull();
  });

  it("says nothing after a change of job", () => {
    expect(
      made([
        ...pay("2026-02-06", "2026-07-10"),
        ...pay("2026-08-14", "2026-10-23", "NEWCO INC PAYROLL"),
        ...spending,
      ]),
    ).toBeNull();
  });

  it("says nothing about an old statement: it goes by where the data ends", () => {
    expect(
      made([...pay("2026-02-06", "2026-08-07"), ...spending.filter((r) => r.date <= "2026-08-07")]),
    ).toBeNull();
  });

  it("says nothing about a job that only paid a few times", () => {
    expect(made([...pay("2026-07-03", "2026-08-07"), ...spending])).toBeNull();
  });
});
