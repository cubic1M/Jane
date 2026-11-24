import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NetWorthChart } from "@/components/hub/net-worth-chart";
import { netWorthCovers } from "./net-worth";

// The founder's Home, 11-23: "not my current net worth", and nothing on the page said which
// accounts the figure held. It says so under the figure now, in the shapes the Plaid sandbox gives.

const acct = (type: string, balanceCents: number | null = 10_000) => ({ type, balanceCents });

describe("what net worth covers", () => {
  it("says no investment account is in it when none is", () => {
    expect(netWorthCovers([acct("depository"), acct("depository"), acct("credit")])).toBe(
      "Counts 2 bank accounts and 1 card. No investment or retirement account is in it.",
    );
  });

  it("names the investment accounts it does count, and drops the warning", () => {
    expect(netWorthCovers([acct("depository"), acct("investment")])).toBe(
      "Counts 1 bank account and 1 investment account.",
    );
  });

  it("lists cards and loans, what is owned and crypto", () => {
    expect(
      netWorthCovers([acct("depository"), acct("credit"), acct("loan"), acct("investment")], {
        owned: 2,
        crypto: true,
      }),
    ).toBe(
      "Counts 1 bank account, 1 card, 1 loan, 1 investment account, 2 things you own and your crypto.",
    );
  });

  it("leaves out an account with no balance, as the figure does, and says nothing with nothing", () => {
    expect(netWorthCovers([acct("depository", null)])).toBeNull();
    expect(netWorthCovers([acct("depository"), acct("credit", null)])).toBe(
      "Counts 1 bank account. No investment or retirement account is in it.",
    );
  });

  it("is on Home's figure, under it", () => {
    const html = renderToStaticMarkup(
      <NetWorthChart
        points={[{ date: "2026-11-01", cents: 120_000 }]}
        covers="Counts 1 bank account. No investment or retirement account is in it."
      />,
    );
    expect(html).toMatch(
      /data-net-worth-covers=""[^>]*>Counts 1 bank account\. No investment or retirement account is in it\.</,
    );
    expect(
      renderToStaticMarkup(<NetWorthChart points={[{ date: "2026-11-01", cents: 1 }]} />),
    ).not.toContain("data-net-worth-covers");
  });
});
