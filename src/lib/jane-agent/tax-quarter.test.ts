import { describe, expect, it } from "vitest";
import type { SelfEmployedView } from "@/lib/self-employed";
import { nextQuarter, quarterMessage } from "./tax-self-employed";

// CodeRabbit part 2: federal and state estimated plans are worked out apart, so a freelancer who
// owes the state but under the federal minimum still gets the state payment reminder.

const plan = (needed: boolean, payments: { date: string; cents: number }[]) => ({
  owedCents: payments.reduce((sum, p) => sum + p.cents, 0),
  needed,
  payments,
});
const view = (federal: ReturnType<typeof plan>, state: ReturnType<typeof plan> | null) =>
  ({
    year: 2026,
    active: true,
    advice: true,
    estimate: { estimate: { state: { code: "CA" } } },
    federal,
    state,
  }) as unknown as SelfEmployedView;

describe("the next estimated payment", () => {
  it("reminds about the state payment when federal is not needed", () => {
    const v = view(plan(false, []), plan(true, [{ date: "2026-12-10", cents: 120_000 }]));
    const q = nextQuarter(v, "2026-12-01");
    expect(q).toEqual({ date: "2026-12-10", cents: 0, stateCents: 120_000 });
    const said = quarterMessage(v, q!);
    expect(said.body).toContain("about $1,200 to California");
    expect(said.body).not.toContain("federal");
    expect(said.actions.map((a) => a.label)).toEqual(["I've paid it"]);
  });

  it("keeps the federal and state payments of the same date together", () => {
    const v = view(
      plan(true, [{ date: "2026-12-10", cents: 300_000 }]),
      plan(true, [{ date: "2026-12-10", cents: 100_000 }]),
    );
    expect(nextQuarter(v, "2026-12-01")).toEqual({
      date: "2026-12-10",
      cents: 300_000,
      stateCents: 100_000,
    });
  });

  it("says nothing when neither is needed or the date is too far off", () => {
    expect(nextQuarter(view(plan(false, []), plan(false, [])), "2026-12-01")).toBeNull();
    const far = view(plan(true, [{ date: "2027-01-15", cents: 300_000 }]), null);
    expect(nextQuarter(far, "2026-09-01")).toBeNull();
  });
});
