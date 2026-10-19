import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { accountId } from "@/data-sources/demo/demo-bank";
import { demoPlaidApi } from "./demo";

// Spec step 112: a loan a new lender paid off shows at zero in the demo bank from that day,
// with its loan details gone, like a real bank.

const TOKEN = "demo:seed1:2026-10-18";
const CAR = accountId("seed1", "auto");

describe("the demo bank after a refinance", () => {
  it("shows the paid-off loan at zero and drops its details from that day", async () => {
    const before = demoPlaidApi(
      TOKEN,
      new Date("2026-10-20T12:00:00Z"),
      [],
      [{ plaidAccountId: CAR, day: "2026-10-21" }],
    );
    const { data: early } = await before.liabilitiesGet({ access_token: TOKEN });
    expect(early.accounts.find((a) => a.account_id === CAR)?.balances.current).toBe(18020);
    expect(early.liabilities.loan?.map((l) => l.account_id)).toContain(CAR);

    const after = demoPlaidApi(
      TOKEN,
      new Date("2026-10-22T12:00:00Z"),
      [],
      [{ plaidAccountId: CAR, day: "2026-10-21" }],
    );
    const { data } = await after.liabilitiesGet({ access_token: TOKEN });
    expect(data.accounts.find((a) => a.account_id === CAR)?.balances.current).toBe(0);
    expect(data.liabilities.loan?.map((l) => l.account_id)).not.toContain(CAR);
    const { data: sync } = await after.transactionsSync({ access_token: TOKEN });
    expect(sync.accounts.find((a) => a.account_id === CAR)?.balances.current).toBe(0);
    // The other loans are untouched.
    expect(data.liabilities.student).toHaveLength(1);
  });
});
