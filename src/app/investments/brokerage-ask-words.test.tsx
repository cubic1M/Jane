import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./brokerage-actions", () => ({ setBrokerageBalanceAction: vi.fn() }));

import { BrokerageAskForm } from "./brokerage-ask";

// Debug 2 (11-16, a Plaid sandbox checking account sending $500 a month to Fidelity, 1280
// light): Investing asked "What's in your Fidelity account today?" and said "Your statements show
// money going in…". The person linked a bank; there are no statements. It says the bank account.

describe("the brokerage balance question", () => {
  it("doesn't talk about statements to someone who linked a bank", () => {
    const html = renderToStaticMarkup(
      <BrokerageAskForm app="Fidelity" sentText="You sent $1,500.00 to Fidelity in 3 transfers." />,
    );
    expect(html).not.toContain("statements");
    expect(html).toContain("Your bank account shows money going in");
  });
});
