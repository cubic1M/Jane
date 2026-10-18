import { describe, expect, it } from "vitest";
import { CHECKING, GEICO, input, monthsAgo, tx } from "../__fixtures__/build";
import { buildStreams } from "../streams";
import type { DetectionInput } from "../types";
import { lowBalanceRisk } from "./low-balance-risk";

const run = (data: DetectionInput) => lowBalanceRisk(data, buildStreams(data));
// Geico on the 1st of each month, so the next bill (Nov 1) is inside the window.
const geico = [3, 2, 1, 0].map((m) => tx({ ...GEICO, date: monthsAgo(m, 1), amountCents: 9_800 }));
const withBalance = (cents: number) =>
  input({
    accounts: [{ ...CHECKING, currentBalanceCents: cents }],
    transactions: geico,
  });

describe("low_balance_risk", () => {
  it("flags a checking account a bill takes below the cushion", () => {
    const [finding] = run(withBalance(15_000));

    expect(finding).toMatchObject({
      type: "low_balance_risk",
      key: "account:acct_checking",
      annualSavingsCents: null,
      amountCents: 5_200,
      confidence: "medium",
    });
    expect(finding.evidence).toMatchObject({ lowestCents: 5_200, lowestDate: "2026-11-01" });
    expect((finding.evidence.bills as unknown[]).length).toBe(1);
  });

  it("is high confidence when the balance would go negative", () => {
    expect(run(withBalance(5_000))[0].confidence).toBe("high");
  });

  it("finds nothing with enough cushion, or with no balance on file", () => {
    expect(run(withBalance(50_000))).toEqual([]);
    expect(
      run(
        input({
          accounts: [{ ...CHECKING, currentBalanceCents: null }],
          transactions: geico,
        }),
      ),
    ).toEqual([]);
  });
});
