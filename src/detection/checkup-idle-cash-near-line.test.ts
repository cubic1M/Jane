import { describe, expect, it } from "vitest";
import { AS_OF, CHECKING, GROCERIES, input, tx } from "./__fixtures__/build";
import { checkup } from "./checkup";
import { addDays } from "./units";

// CodeRabbit 1c detn-01 #1: cash over the cushion by less than the amount Jane flags was
// described as "under 3 months of spending", though it covers more than that.

// About $1,000 a month of groceries for four months, to today.
function spender(balanceCents: number) {
  const transactions = [];
  for (let back = 120; back >= 0; back -= 4) {
    transactions.push(
      tx({
        ...GROCERIES,
        accountId: CHECKING.id,
        date: addDays(AS_OF, -back),
        amountCents: 13_300,
      }),
    );
  }
  return input({ accounts: [{ ...CHECKING, currentBalanceCents: balanceCents }], transactions });
}
const idle = (balanceCents: number) =>
  checkup(spender(balanceCents)).find((l) => l.label === "Idle cash");

describe("the idle cash line near the line Jane flags", () => {
  it("doesn't say 'under 3 months' for cash that covers more", () => {
    const line = idle(350_000);
    expect(line?.status).toBe("passed");
    expect(line?.line).toMatch(/months of spending/);
    expect(line?.line).not.toMatch(/under/);
  });

  it("still says 'under' when the cash is short of the cushion", () => {
    expect(idle(200_000)?.line).toMatch(/under 3 months of spending/);
  });
});
