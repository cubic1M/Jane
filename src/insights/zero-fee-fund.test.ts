import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { HOLDINGS_DETECTORS } from "@/detectors/holdings";
import { runDetectors } from "@/detectors/index";
import { PLANNING_DETECTORS } from "@/detectors/planning";
import { feesReply } from "@/lib/jane-agent/investments/replies";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { feeSummary } from "./investment-fees";
import { investmentSummary } from "./investments";

// FZROX and FZILX are the fund table's first funds that cost nothing (0 basis points, #2199). A
// zero is a known cost, not a missing one: the fund is counted, at 0.00% and $0.00 a year, and is
// never "cost not known" nor a fund with a cheaper one beside it.

const VALUE = 1_250_000;

describe("a fund that costs nothing", () => {
  const summary = investmentSummary(
    [
      {
        id: "acc_brk",
        name: "Brokerage",
        subtype: "brokerage",
        balanceCents: VALUE,
        institution: "Fidelity",
      },
    ],
    [
      {
        id: "sec_fzrox",
        name: "Fidelity ZERO Total Market Index Fund",
        ticker: "FZROX",
        type: "mutual fund",
        isCashEquivalent: false,
      },
    ],
    [
      {
        id: "h_fzrox",
        accountId: "acc_brk",
        securityId: "sec_fzrox",
        quantity: 500,
        priceCents: 2_500,
        priceAsOf: "2026-11-19",
        valueCents: VALUE,
        costBasisCents: 1_000_000,
      },
    ],
  );

  it("is a fund of known cost: 0.00% and $0.00 a year", () => {
    const fees = feeSummary(summary.accounts, []);
    expect(fees.unknown).toEqual([]);
    expect(fees.funds.map((f) => [f.holding.ticker, f.expenseRatioBps, f.yearlyCents])).toEqual([
      ["FZROX", 0, 0],
    ]);
    expect(fees.equivalents).toEqual([]);
    const body = feesReply(fees, false).body;
    expect(body).toContain("$0.00 a year");
    expect(body).toContain("at 0.00% a year");
    expect(body).not.toContain("I don't know the yearly cost");
    expect(body).not.toContain("I don't see any investment fees");
  });

  it.each(["brokerage", "401k"])("raises no fee or cheaper-fund card, held in a %s", (subtype) => {
    const base = inputFor("renter");
    const data: ProfileInput = {
      ...base,
      accounts: [
        ...base.accounts,
        { id: "acc_fz", name: "Fidelity", type: "investment", subtype, balanceCents: VALUE },
      ],
      holdings: [
        ...(base.holdings ?? []),
        { accountId: "acc_fz", valueCents: VALUE, basisCents: 1_000_000, ticker: "FZROX" },
      ],
    };
    const cards = runDetectors({ profile: buildProfile(data), data }, [
      ...HOLDINGS_DETECTORS,
      ...PLANNING_DETECTORS,
    ]);
    const named = cards.filter((s) => /FZROX|ZERO Total|not known/i.test(JSON.stringify(s)));
    expect(named.map((s) => s.topic)).toEqual([]);
  });
});
