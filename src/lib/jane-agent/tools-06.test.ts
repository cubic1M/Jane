import { describe, expect, it } from "vitest";
import { orderFits } from "@/lib/goal-tradeoffs";
import type { TaxDocumentsView } from "@/lib/tax-documents";
import type { Snapshot } from "./snapshot";
import { studentLongGameSource } from "./sources/student-long-game";
import { collectedMessage } from "./tax-documents-message";

// CodeRabbit part 2 (tools-06).

describe("student loan paperwork reminders", () => {
  const gather = (certifyOn: string | null) =>
    studentLongGameSource.gather(
      {
        asOf: "2026-11-20",
        studentLongGame: { available: true, certifyOn, recertifyOn: null },
      } as unknown as Snapshot,
      {} as never,
    );

  it("reminds before the date, not after it has passed", () => {
    expect(gather("2026-11-30")).toHaveLength(1);
    expect(gather("2026-11-20")).toHaveLength(1);
    expect(gather("2026-11-19")).toEqual([]);
  });
});

describe("the collected tax forms card", () => {
  const form = (key: string, received: boolean) => ({
    key,
    formKey: "w2",
    document: { id: key },
    usable: true,
    received,
    check: { status: "matches" },
  });
  const view = (received: boolean) =>
    ({ year: 2026, forms: [form("a", received), form("b", true)] }) as unknown as TaxDocumentsView;

  it("says 'ticked off' only when they are, whatever the overall autopilot level", () => {
    const waiting = collectedMessage(view(false))!;
    expect(waiting.body).not.toContain("ticked");
    expect(waiting.actions.map((a) => a.id)).toContain("tax.docs_tick");
    const done = collectedMessage(view(true))!;
    expect(done.body).toContain("ticked");
    expect(done.actions.map((a) => a.id)).not.toContain("tax.docs_tick");
  });
});

describe("a saved goal order", () => {
  it("is for those goals only", () => {
    expect(orderFits(["a", "b"], ["b", "a"])).toBe(true);
    expect(orderFits(["a", "b"], ["b", "c"])).toBe(false);
    expect(orderFits(["a", "b"], ["a", "b", "c"])).toBe(false);
  });
});
