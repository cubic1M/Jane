import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { COVER_GAP_DETECTORS } from "./cover-gaps";
import { monthlyChargeYear } from "./helpers";

// CodeRabbit sweep 1c (#2270): a premium stream is judged by its own cadence and put on the policy
// whose deductible would change, never on a combined stream.
const row = (date: string, amountCents: number, description: string) => ({
  date,
  amountCents,
  description,
});
const months = (n: number) =>
  Array.from({ length: n }, (_, i) => `2026-${String(i + 4).padStart(2, "0")}-03`);

describe("monthlyChargeYear by stream", () => {
  it("does not multiply an annual premium by the months of a monthly one", () => {
    const rows = [
      ...months(3).map((d) => row(d, 10_000, "BLUE CROSS")),
      row("2026-05-20", 120_000, "AETNA"),
    ];
    expect(monthlyChargeYear(rows)).toBeNull();
  });
  it("keeps the monthly stream's own year", () => {
    const rows = months(3).map((d) => row(d, 10_000, "BLUE CROSS 1234"));
    expect(monthlyChargeYear(rows)).toBe(120_000);
  });
  it("adds two streams that are each monthly", () => {
    const rows = [
      ...months(3).map((d) => row(d, 10_000, "BLUE CROSS")),
      ...months(4).map((d) => row(d, 5_000, "AETNA")),
    ];
    expect(monthlyChargeYear(rows)).toBe(120_000 + 60_000);
  });
});

const deductible = (edit: (data: ReturnType<typeof inputFor>) => void) => {
  const data = inputFor("family");
  edit(data);
  const profile = buildProfile(data);
  const d = COVER_GAP_DETECTORS.find((x) => x.topic === "deductible_fit")!;
  return d.detect({ profile, data });
};
const insurance = (date: string, amountCents: number, description: string) => ({
  date,
  amountCents,
  description,
  pfc: "GENERAL_SERVICES_INSURANCE",
});

describe("deductible card premiums", () => {
  it("still reaches a person with one car policy", () => {
    expect(deductible(() => {})).not.toBeNull();
  });
  it("does not read a carrier's home premiums as the car's", () => {
    const s = deductible((data) => {
      const homes = [5, 6, 7, 8, 9, 10].map(
        (m) =>
          insurance(`2026-${String(m).padStart(2, "0")}-10`, 15_000, "GEICO HOMEOWNERS") as never,
      );
      data.transactions = [
        ...data.transactions.filter((t) => t.pfc !== "GENERAL_SERVICES_INSURANCE"),
        ...homes,
      ];
    });
    expect(s).toBeNull();
  });
  it("gives no yearly saving when two policies share the kind", () => {
    const s = deductible((data) => {
      const extras = data.extras as unknown as { coverPolicies: unknown[] };
      extras.coverPolicies = [
        ...extras.coverPolicies,
        {
          id: "family-auto-2",
          kind: "auto",
          status: "active",
          deductibleCents: 50_000,
          coverage: {
            bodilyInjuryPerPerson: 5_000_000,
            bodilyInjuryPerAccident: 10_000_000,
            collision: true,
          },
        },
      ];
    });
    expect(s).toBeNull();
  });
});
