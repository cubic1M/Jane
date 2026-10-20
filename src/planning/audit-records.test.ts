import { describe, expect, it } from "vitest";
import { RETENTION, RETENTION_REMIND_DAYS } from "@/config/records";
import {
  buildAuditPack,
  matchReceipt,
  retentionFor,
  retentionSchedule,
  type AuditItem,
} from "./audit-records";

// Spec step 171: nothing in the pack lacks its source; retention follows config.

const item = (over: Partial<AuditItem>): AuditItem => ({
  key: "charity",
  label: "Donations",
  claimedCents: 10_000,
  evidence: [],
  needs: [],
  ...over,
});
const tx = {
  kind: "transaction" as const,
  id: "t1",
  date: "2026-05-01",
  payee: "Red Cross",
  cents: 10_000,
  receipt: false,
};

describe("the audit pack", () => {
  it("puts only items with a source in the pack, and lists the rest as gaps", () => {
    const pack = buildAuditPack(2026, [
      item({ evidence: [tx] }),
      item({ key: "mileage", label: "Business miles", claimedCents: 7_250 }),
      item({ key: "medical", label: "Medical", claimedCents: 0 }),
    ]);
    expect(pack.items.map((i) => i.key)).toEqual(["charity"]);
    for (const i of pack.items) expect(i.evidence.length).toBeGreaterThan(0);
    expect(pack.gaps).toEqual([
      expect.objectContaining({ key: "mileage", needs: ["A document or receipt for it."] }),
    ]);
  });

  it("flags items in the pack that still need something", () => {
    const pack = buildAuditPack(2026, [
      item({ evidence: [tx], needs: ["The charity's receipt."] }),
      item({ key: "medical", evidence: [tx] }),
    ]);
    expect(pack.incomplete.map((i) => i.key)).toEqual(["charity"]);
  });

  it("matches a receipt by amount and date within the days", () => {
    const receipts = [
      { id: "d1", fileName: "redcross.pdf", date: "2026-05-03", cents: 10_000 },
      { id: "d2", fileName: "other.pdf", date: "2026-05-01", cents: 9_999 },
      { id: "d3", fileName: "undated.pdf", date: null, cents: 10_000 },
    ];
    expect(matchReceipt({ date: "2026-05-01", cents: 10_000 }, receipts, 3)).toEqual({
      id: "d1",
      fileName: "redcross.pdf",
    });
    expect(matchReceipt({ date: "2026-05-07", cents: 10_000 }, receipts, 3)).toBeNull();
  });
});

describe("how long to keep records", () => {
  it("follows config: the filing deadline of the year after, plus the years", () => {
    const r = retentionFor(2022, "return", "2026-01-01");
    expect(r.keepUntil).toBe(`${2022 + 1 + RETENTION.return.years}-04-15`);
    expect(r.keepUntil).toBe("2026-04-15");
    expect(r.remindOn).toBe("2026-03-16");
    expect(RETENTION_REMIND_DAYS).toBe(30);
  });

  it("says keep, soon, or can go", () => {
    expect(retentionFor(2022, "return", "2026-03-15").status).toBe("keep");
    expect(retentionFor(2022, "return", "2026-03-16").status).toBe("soon");
    expect(retentionFor(2022, "return", "2026-04-15").status).toBe("soon");
    expect(retentionFor(2022, "return", "2026-04-16").status).toBe("can_go");
  });

  it("schedules each year once, oldest first", () => {
    expect(
      retentionSchedule([2024, 2022, 2024], "2026-10-19").map((r) => [r.year, r.status]),
    ).toEqual([
      [2022, "can_go"],
      [2024, "keep"],
    ]);
  });
});
