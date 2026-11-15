import { describe, expect, it } from "vitest";
import { plansTree, type PlansTreeInput } from "./plans";

// Debugger 11-15: Plans & goals said "Return window for West Marine: Due today." for a $640
// purchase on its last day to go back. Nothing was due; the window was closing. A date's line
// says what happens that day: a bill is due, a return window ends, anything else just comes.

const input = (deadlines: PlansTreeInput["deadlines"]): PlansTreeInput => ({
  asOf: "2026-11-15",
  deadlines,
  goals: [],
  competing: false,
  netWorth: null,
  lifeEvents: { open: 0, newest: null },
  lastMonth: { label: "October" },
  year: 2026,
  yearly: { monthlyCents: 0, bills: 0 },
  debt: { accounts: 0, owedCents: 0 },
});

const lineFor = (kind: string, date: string) => {
  const { summaries } = plansTree(
    input([{ key: "d", title: "A date", date, kind, amountCents: 64_000 } as never]),
  );
  return summaries["coming:d"];
};

describe("a date on Plans & goals", () => {
  it("is a return's last day, not a payment due", () => {
    expect(lineFor("return", "2026-11-15")).toBe("Last day to return it.");
    expect(lineFor("return", "2026-11-16")).toBe("Last day to return it is tomorrow.");
    expect(lineFor("return", "2026-11-20")).toBe("5 days left to return it.");
  });

  it("is due when it's a payment or a bill", () => {
    expect(lineFor("payment", "2026-11-15")).toBe("Due today.");
    expect(lineFor("bill", "2026-11-16")).toBe("Due tomorrow.");
  });

  it("just comes when it's a trial, renewal or warranty", () => {
    for (const kind of ["trial", "renewal", "warranty"]) {
      expect(lineFor(kind, "2026-11-15"), kind).toBe("Today.");
      expect(lineFor(kind, "2026-11-20"), kind).toBe("In 5 days.");
    }
  });
});
