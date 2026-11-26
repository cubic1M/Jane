import { describe, expect, it } from "vitest";
import { auditPackCsv, buildAuditPack, medicalFigures, type AuditItem } from "./audit-records";

// Medical costs in the audit pack: "Claimed" is what the estimate counts, and everything paid is
// its own line.

const deduction = (kind: "standard" | "itemized", medicalCents: number) => ({
  kind,
  itemized: { medicalCents },
});
const medical = (over: Partial<AuditItem>): AuditItem => ({
  key: "medical",
  label: "Medical",
  claimedCents: 0,
  evidence: [
    {
      kind: "transaction",
      id: "t1",
      date: "2026-05-01",
      payee: "Clinic",
      cents: 500_000,
      receipt: false,
    },
  ],
  needs: [],
  ...over,
});

describe("the medical figures", () => {
  it("claims the part over the floor when the estimate itemizes", () => {
    expect(medicalFigures(500_000, deduction("itemized", 125_000))).toEqual({
      claimedCents: 125_000,
      gross: { label: "All medical costs paid, before the 7.5% of income floor", cents: 500_000 },
    });
  });

  it("claims nothing under the floor, and says so", () => {
    expect(medicalFigures(500_000, deduction("itemized", 0))).toEqual({
      claimedCents: 0,
      gross: { label: "All medical costs paid, none over 7.5% of income", cents: 500_000 },
    });
  });

  it("claims nothing when the estimate takes the standard deduction", () => {
    expect(medicalFigures(500_000, deduction("standard", 125_000))).toEqual({
      claimedCents: 0,
      gross: {
        label:
          "All medical costs paid (the estimate takes the standard deduction, so none is claimed)",
        cents: 500_000,
      },
    });
  });
});

describe("an item with nothing claimed but costs paid", () => {
  const gross = { label: "All medical costs paid", cents: 500_000 };

  it("stays in the pack with its sources", () => {
    const pack = buildAuditPack(2026, [medical({ gross })]);
    expect(pack.items.map((i) => i.key)).toEqual(["medical"]);
  });

  it("downloads as two lines, each with its own label and figure", () => {
    const csv = auditPackCsv(buildAuditPack(2026, [medical({ claimedCents: 12_500, gross })]));
    expect(csv).toContain("Medical,Claimed,,,125.00\r\n");
    expect(csv).toContain("Medical,All medical costs paid,,,5000.00\r\n");
  });
});
