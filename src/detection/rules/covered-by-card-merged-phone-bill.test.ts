import { describe, expect, it } from "vitest";
import { CARD, CHECKING, input, monthly, plaidStream } from "../__fixtures__/build";
import { buildStreams } from "../streams";
import { coveredByCard } from "./covered-by-card";

const phoneBill = (accountId: string) => ({
  description: "VERIZON WIRELESS",
  merchantName: "Verizon Wireless",
  accountId,
  pfcPrimary: "RENT_AND_UTILITIES",
  pfcDetailed: "RENT_AND_UTILITIES_TELEPHONE",
});

describe("a phone bill paid from another account still blocks the cover claim", () => {
  const protection = monthly(4, 1_700, {
    description: "ASURION WIRELESS PROTECTION",
    merchantName: "Asurion",
    // On checking: the card's own account is read from Plaid's streams, not our fallback.
    accountId: CHECKING.id,
    pfcPrimary: "GENERAL_SERVICES",
    pfcDetailed: "GENERAL_SERVICES_INSURANCE",
  });
  const onCard = monthly(4, 14_500, phoneBill(CARD.id)).map((t, i) => ({
    ...t,
    plaidTransactionId: `v${i}`,
  }));
  const plaid = plaidStream({
    accountId: CARD.id,
    merchantName: "Verizon Wireless",
    lastAmountCents: 14_500,
    averageAmountCents: 14_500,
    lastDate: onCard.at(-1)!.date,
    pfcPrimary: "RENT_AND_UTILITIES",
    pfcDetailed: "RENT_AND_UTILITIES_TELEPHONE",
    transactionIds: ["v0", "v1", "v2", "v3"],
  });
  const run = (extra: ReturnType<typeof monthly>) => {
    const d = input({
      transactions: [...onCard, ...extra, ...protection],
      recurringStreams: [plaid],
      cardProducts: { [CARD.id]: "demo-card" },
    });
    return coveredByCard(d, buildStreams(d));
  };

  it("raises nothing when an identical bill is paid from checking too", () => {
    expect(run(monthly(4, 14_500, phoneBill(CHECKING.id)))).toEqual([]);
  });

  it("raises it when the card carries the only phone bill", () => {
    expect(run([])).toHaveLength(1);
  });
});
