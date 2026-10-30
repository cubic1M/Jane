import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { DETECTORS } from "./index";

const bankFees = DETECTORS.find((d) => d.topic === "bank_fees")!;
const OVERDRAWN = ["BANK_FEES_OVERDRAFT_FEES", "BANK_FEES_INSUFFICIENT_FUNDS"];

// Night QA 10-30: a traveller's foreign-transaction and annual card fees read as "Stop paying
// overdraft and bank fees", though nothing was ever overdrawn.
describe("the bank fees suggestion's words", () => {
  const base = inputFor("renter");
  const clean = base.transactions.filter((t) => !OVERDRAWN.includes(t.pfc ?? ""));
  const fee = (date: string, cents: number, pfc: string, description: string) => ({
    date,
    amountCents: cents,
    description,
    pfc,
    accountId: base.transactions[0].accountId,
  });
  const card = [
    fee("2026-09-12", 500, "BANK_FEES_FOREIGN_TRANSACTION_FEES", "FOREIGN TRANSACTION FEE"),
    fee("2026-09-14", 400, "BANK_FEES_FOREIGN_TRANSACTION_FEES", "FOREIGN TRANSACTION FEE"),
    fee("2026-10-03", 9_500, "BANK_FEES_OTHER_BANK_FEES", "ANNUAL MEMBERSHIP FEE"),
  ];
  const run = (transactions: typeof base.transactions) => {
    const data = { ...base, transactions };
    return bankFees.detect({ profile: buildProfile(data), data });
  };

  it("says bank and card fees when none were for being overdrawn", () => {
    expect(run([...clean, ...card])?.title).toBe("Stop paying bank and card fees");
  });

  it("says overdraft when there was one", () => {
    const overdraft = fee("2026-09-20", 3_400, "BANK_FEES_OVERDRAFT_FEES", "OVERDRAFT FEE");
    expect(run([...clean, ...card, overdraft])?.title).toBe("Stop paying overdraft and bank fees");
  });
});
