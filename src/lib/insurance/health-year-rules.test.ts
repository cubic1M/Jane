import { describe, expect, it } from "vitest";
import {
  disputes,
  fsaStatus,
  networkOf,
  personShare,
  planBills,
  progress,
  type Bill,
  type Plan,
} from "./health-year-rules";

// Health cover all year (spec step 200).

const plan: Plan = {
  label: "Acme PPO",
  deductibleCents: 150_000,
  outOfPocketMaxCents: 450_000,
  coinsurance: 20,
};
const bill = (id: string, date: string, cents: number, category: string | null = null): Bill => ({
  id,
  date,
  provider: id,
  cents,
  category,
});

describe("personShare", () => {
  it("is the whole bill inside the deductible, then the coinsurance share", () => {
    const none = { deductiblePaidCents: 0, oopPaidCents: 0 };
    expect(personShare(plan, 100_000, none)).toBe(100_000);
    expect(personShare(plan, 250_000, none)).toBe(150_000 + 20_000);
  });

  it("never goes past the out-of-pocket maximum", () => {
    expect(
      personShare(plan, 5_000_000, { deductiblePaidCents: 150_000, oopPaidCents: 440_000 }),
    ).toBe(10_000);
  });
});

describe("progress", () => {
  it("counts the deductible met and the month the maximum is reached at this pace", () => {
    const bills = [bill("a", "2026-02-01", 100_000), bill("b", "2026-06-01", 1_500_000)];
    const p = progress(plan, bills, "2026-10-19");
    expect(p.deductibleMetCents).toBe(150_000);
    expect(p.oopSoFarCents).toBe(440_000);
    expect(p.deductibleLeftCents).toBe(0);
    expect(p.oopLeftCents).toBe(10_000);
    expect(p.maxMonth).toBe(10);
  });

  it("says reached once the maximum is paid, and not on pace with little spending", () => {
    expect(progress(plan, [bill("x", "2026-03-01", 3_000_000)], "2026-10-19").maxMonth).toBe(
      "reached",
    );
    expect(progress(plan, [bill("y", "2026-03-01", 5_000)], "2026-10-19").maxMonth).toBeNull();
  });

  it("leaves dental and vision out of the plan's spending", () => {
    const bills = planBills([
      bill("d", "2026-03-01", 18_000, "MEDICAL_DENTAL_CARE"),
      bill("e", "2026-03-02", 9_000, "MEDICAL_EYE_CARE"),
      bill("c", "2026-03-03", 7_000, "MEDICAL_PRIMARY_CARE"),
    ]);
    expect(bills.map((b) => b.id)).toEqual(["c"]);
  });
});

describe("fsaStatus", () => {
  it("shows the money left and the use-it-or-lose-it date", () => {
    const s = fsaStatus(120_000, 40_000, "2026-10-19");
    expect(s.leftCents).toBe(80_000);
    expect(s.deadline).toBe("2026-12-31");
    expect(s.daysLeft).toBe(73);
    expect(s.warn).toBe(true);
  });

  it("stays quiet far from the deadline or with nothing left", () => {
    expect(fsaStatus(120_000, 0, "2026-03-01").warn).toBe(false);
    expect(fsaStatus(120_000, 200_000, "2026-11-01").warn).toBe(false);
  });
});

describe("networkOf", () => {
  const dir = [
    { match: /cvs/i, inNetwork: true },
    { match: /lakeside/i, inNetwork: false },
  ];
  it("checks the directory and says it can't tell for anyone else", () => {
    expect(networkOf("CVS/PHARMACY #1", dir)).toBe("in");
    expect(networkOf("Lakeside Urgent Care", dir)).toBe("out");
    expect(networkOf("Dr Nobody", dir)).toBe("unknown");
  });
});

describe("disputes", () => {
  const net = () => "in" as const;

  it("opens one for a big bill above the plan's share", () => {
    const found = disputes(
      plan,
      [bill("pharmacy", "2026-03-01", 4_680), bill("scan", "2026-09-23", 190_000)],
      net,
    );
    expect(found).toHaveLength(1);
    expect(found[0].bill.id).toBe("scan");
    expect(found[0].shouldPayCents).toBe(145_320 + Math.round(((190_000 - 145_320) * 20) / 100));
    expect(found[0].overCents).toBe(190_000 - found[0].shouldPayCents);
  });

  it("leaves a bill that sits inside the deductible, a small bill and an out-of-network one", () => {
    expect(disputes(plan, [bill("a", "2026-03-01", 100_000)], net)).toEqual([]);
    expect(
      disputes({ ...plan, deductibleCents: 0 }, [bill("b", "2026-03-01", 20_000)], net),
    ).toEqual([]);
    expect(
      disputes({ ...plan, deductibleCents: 0 }, [bill("c", "2026-03-01", 190_000)], () => "out"),
    ).toEqual([]);
  });
});
