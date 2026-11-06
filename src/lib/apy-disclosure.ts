// How a savings rate is shown, everywhere it's shown (connectors roadmap round 13). Reg DD's
// advertising rules reach anyone who advertises a bank account (12 CFR 1030.1(c)): a rate is an
// "annual percentage yield", with the date it's accurate as of, the minimum to earn it, that it may
// change, and that fees could reduce the earnings (1030.8(c)). Internet ads aren't exempt
// (1030.8(e)). Not legal advice: counsel to confirm.

export const APY_MAY_CHANGE = "Rate may change after the account is opened.";
export const APY_FEES = "Fees could reduce the earnings on the account.";

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  });

// "Annual Percentage Yield (APY) 4.00% as of 2026-11-05": the rate, its full name, and its day.
export function apyHeadline(apyBps: number, asOf: string): string {
  return `Annual Percentage Yield (APY) ${(apyBps / 100).toFixed(2)}% as of ${asOf}`;
}

// The lines that go with every APY.
export function apyDisclosures(minimumToEarnCents: number): string[] {
  return [
    minimumToEarnCents > 0
      ? `Minimum to earn the APY: ${money(minimumToEarnCents)}.`
      : "No minimum balance to earn the APY.",
    APY_MAY_CHANGE,
    APY_FEES,
  ];
}
