import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";

// CodeRabbit sweep 1b: a state tax refund in February hid the reminder to file the federal
// return.
const topics = (description: string) => {
  const d = inputFor("freelancer");
  const data = {
    ...d,
    today: "2026-03-10",
    transactions: [
      ...d.transactions.filter((t) => t.pfc !== "INCOME_TAX_REFUND"),
      {
        date: "2026-02-20",
        amountCents: -40_000,
        description,
        pfc: "INCOME_TAX_REFUND",
        accountId: d.accounts[0]!.id,
      },
    ],
  };
  return runDetectors({ profile: buildProfile(data), data }).map((s) => s.topic);
};

describe("which refund shows the federal return was filed", () => {
  it("not a state refund", () => {
    expect(topics("CA FTB STATE TAX REFUND")).toContain("file_return");
  });
  it("not a state's Treasury either", () => {
    expect(topics("MICHIGAN TREASURY TAX REFUND")).toContain("file_return");
  });
  it("a federal one by its bank name", () => {
    expect(topics("TREAS 310 TAX REF")).not.toContain("file_return");
    expect(topics("US TREASURY TAX REFUND")).not.toContain("file_return");
  });
  it("a federal one", () => {
    expect(topics("IRS TREAS 310 TAX REF")).not.toContain("file_return");
  });
});
