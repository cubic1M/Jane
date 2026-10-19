import { describe, expect, it } from "vitest";
import { ESTIMATED_TAX_DATES } from "@/config/tax-pack";
import { TAX_PLAN, W4_AFTER_EVENT_DAYS, type PlanMoveKey } from "@/config/tax-plan";
import { taxPlan, type PlanFacts } from "./tax-plan";

// Spec step 167: every move has its deadline from config, and nothing past its deadline is
// offered.

const facts = (over: Partial<PlanFacts> = {}): PlanFacts => ({
  year: 2026,
  today: "2026-10-18",
  advice: true,
  savings: [
    {
      key: "retirement",
      title: "Put about $500 more a paycheck into your 401(k)",
      estimateCents: 120_000,
    },
    { key: "ira", title: "Put up to $7,000 in a traditional IRA for 2026", estimateCents: 154_000 },
    { key: "hsa", title: "Use your HSA's room", estimateCents: 90_000 },
    {
      key: "health_fsa",
      title: "Pay about $1,200 of medical costs from a health FSA",
      estimateCents: 30_000,
    },
  ],
  estimated: [
    { date: "2026-09-15", cents: 150_000 },
    { date: "2027-01-15", cents: 150_000 },
  ],
  harvest: { name: "VTI", lossCents: 300_000 },
  donationsCents: 25_000,
  lifeEvents: [{ kind: "new_job", startedOn: "2026-10-01" }],
  filed: false,
  ...over,
});

const year = (d: { nextYear: boolean }) => (d.nextYear ? 2027 : 2026);

describe("the year-round tax plan", () => {
  it("gives every move its deadline from config", () => {
    const moves = taxPlan(facts({ today: "2026-01-02" }));
    expect(moves.length).toBeGreaterThan(5);
    for (const m of moves) {
      if (m.key === "w4_life_event") {
        expect(m.deadline).toBe("2026-10-31");
        continue;
      }
      const rule = TAX_PLAN[m.key];
      expect(m.deadline, m.key).toBe(`${year(rule.deadline)}-${rule.deadline.md}`);
      expect(m.opensOn, m.key).toBe(`${year(rule.opens)}-${rule.opens.md}`);
      expect(m.task.dueOn, m.key).toBe(m.deadline);
    }
  });

  it("puts the estimated payments on the IRS's four dates", () => {
    const dates = ESTIMATED_TAX_DATES.map(
      (d) =>
        `${d.nextYear ? 2027 : 2026}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`,
    );
    expect(
      ([1, 2, 3, 4] as const).map((n) => {
        const d = TAX_PLAN[`estimated_${n}` as PlanMoveKey].deadline;
        return `${year(d)}-${d.md}`;
      }),
    ).toEqual(dates);
  });

  it("never offers anything past its deadline", () => {
    const keys = (today: string) => taxPlan(facts({ today })).map((m) => m.key);
    expect(keys("2026-10-18")).toEqual([
      "w4_life_event",
      "fsa_enroll",
      "workplace_retirement",
      "harvest",
      "giving",
      "estimated_4",
      "ira",
      "hsa",
      "file",
    ]);
    // The September payment's gone; so is the W-4 check a month after the new job.
    expect(keys("2026-11-01")).not.toContain("w4_life_event");
    expect(keys("2027-01-02")).toEqual(["estimated_4", "ira", "hsa", "file"]);
    expect(keys("2027-04-16")).toEqual([]);
    for (const today of ["2026-03-01", "2026-12-31", "2027-01-15", "2027-04-15"]) {
      for (const m of taxPlan(facts({ today }))) expect(m.deadline >= today).toBe(true);
    }
  });

  it("brings each move up between its opening and its deadline", () => {
    const moves = taxPlan(facts({ today: "2026-10-18" }));
    const open = (key: string) => moves.find((m) => m.key === key)!.open;
    expect(open("workplace_retirement")).toBe(true);
    expect(open("harvest")).toBe(true);
    expect(open("fsa_enroll")).toBe(true);
    expect(open("giving")).toBe(false);
    expect(open("file")).toBe(false);
  });

  it("checks the W-4 within a month of a new job or baby", () => {
    const [w4] = taxPlan(facts({ today: "2026-10-05" })).filter((m) => m.key === "w4_life_event");
    expect(w4).toMatchObject({
      title: "Check your W-4 after your new job",
      opensOn: "2026-10-01",
      open: true,
    });
    expect(Date.parse(w4.deadline) - Date.parse(w4.opensOn)).toBe(W4_AFTER_EVENT_DAYS * 86_400_000);
    expect(
      taxPlan(facts({ lifeEvents: [{ kind: "moving", startedOn: "2026-10-01" }] })).some(
        (m) => m.key === "w4_life_event",
      ),
    ).toBe(false);
  });

  it("leaves recommendations out without demo advice, and filing once it's filed", () => {
    const keys = taxPlan(facts({ advice: false, filed: true })).map((m) => m.key);
    expect(keys).toEqual(["w4_life_event", "estimated_4"]);
    expect(
      taxPlan(facts())
        .filter((m) => m.advice)
        .map((m) => m.key)
        .sort(),
    ).toEqual(["fsa_enroll", "giving", "harvest", "hsa", "ira", "workplace_retirement"].sort());
  });

  it("says what each is for, with the amounts Jane knows", () => {
    const moves = taxPlan(facts());
    expect(moves.find((m) => m.key === "harvest")!.detail).toBe(
      "VTI is down about $3,000. A sale by December 31 counts for 2026; buying it back within 30 days is a wash sale.",
    );
    expect(moves.find((m) => m.key === "estimated_4")).toMatchObject({
      amountCents: 150_000,
      detail: "About $1,500 for 2026, by Jan 15.",
      ownMessage: true,
    });
    expect(moves.find((m) => m.key === "ira")!.task).toEqual({
      title: "Make your IRA contribution (2026 taxes)",
      dueOn: "2027-04-15",
      note: "Put up to $7,000 in a traditional IRA for 2026. You can make it until the April filing deadline. It could save about $1,540.",
    });
  });
});
