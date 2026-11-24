import { describe, expect, it, vi } from "vitest";
import type { DetectionTransaction } from "@/detection/types";

const lines: DetectionTransaction[] = [
  ["v1", "2026-09-20", 2_000],
  ["v2", "2026-10-20", 2_000],
  ["v3", "2026-11-20", 10_000],
].map(([id, date, cents]) => ({
  id: String(id),
  accountId: "a1",
  plaidTransactionId: null,
  date: String(date),
  amountCents: Number(cents),
  description: "VERCEL INC",
  merchantName: "Vercel",
  pfcPrimary: null,
  pfcDetailed: null,
  categorySource: null,
}));
vi.mock("@/detection/input", () => ({
  loadDetectionInput: vi.fn(async () => ({ transactions: lines })),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
// The invoice is read in memory: nothing here may reach the database.
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get() {
        throw new Error("the invoice page touched the database");
      },
    },
  ),
}));

import { readInvoice } from "./actions";

// Reading a pasted invoice on /invoice (founder 11-24).

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

describe("readInvoice", () => {
  it("lists the line items and sets them against the charge", async () => {
    const state = await readInvoice(
      null,
      form({ invoice: "Pro plan  $20.00\nOverage  $80.00\nTotal  $100.00", charge: "v3" }),
    );
    expect(state?.ok).toBe(true);
    const text = state!.lines.join("\n");
    expect(text).toContain("You paid Vercel $100.00 on Nov 20.");
    expect(text).toContain("The invoice lists 2 lines:");
    expect(text).toContain("The Overage ($80.00) line accounts for the extra $80.00.");
  });

  it("lists the lines alone with no charge, or one that isn't theirs", async () => {
    const invoice = "Pro plan  $20.00\nTotal  $20.00";
    const withNone: Record<string, string> = { invoice };
    for (const fields of [withNone, { invoice, charge: "someone-elses" }]) {
      const state = await readInvoice(null, form(fields));
      expect(state?.ok).toBe(true);
      expect(state!.lines.join("\n")).not.toMatch(/usual|You paid/);
    }
  });

  it("asks for text when there is none, and says what it can't read", async () => {
    expect(await readInvoice(null, form({ invoice: "  " }))).toMatchObject({
      ok: false,
      message: "Paste the invoice's text first.",
    });
    expect(await readInvoice(null, form({}))).toMatchObject({ ok: false });
    const pdf = await readInvoice(null, form({ invoice: "%PDF-1.7 binary" }));
    expect(pdf).toMatchObject({ ok: false });
    expect(pdf?.message).toContain("A PDF or a picture can't be read here");
  });

  it("refuses text that is too long", async () => {
    const state = await readInvoice(null, form({ invoice: "Item  $1.00\n".repeat(1_000) }));
    expect(state).toMatchObject({ ok: false });
    expect(state?.message).toContain("too long");
  });
});
