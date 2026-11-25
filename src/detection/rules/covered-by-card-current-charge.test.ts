import { describe, expect, it } from "vitest";
import { CARD, input, monthly, monthsAgo, tx } from "../__fixtures__/build";
import { buildStreams } from "../streams";
import type { DetectionInput } from "../types";
import { coveredByCard } from "./covered-by-card";

// CodeRabbit on #2263: an Assurant stream is classified from its current charge, not any past one.
const phoneBill = {
  description: "VERIZON WIRELESS",
  merchantName: "Verizon Wireless",
  accountId: CARD.id,
  pfcPrimary: "RENT_AND_UTILITIES",
  pfcDetailed: "RENT_AND_UTILITIES_TELEPHONE",
};
const insurance = (description: string) => ({
  description,
  merchantName: "Assurant",
  accountId: CARD.id,
  pfcPrimary: "GENERAL_SERVICES",
  pfcDetailed: "GENERAL_SERVICES_INSURANCE",
});

describe("an Assurant stream that changed from phone protection to another policy", () => {
  it("is not phone protection now", () => {
    const d: DetectionInput = input({
      transactions: [
        ...monthly(4, 14_500, phoneBill),
        // Phone protection in months 5 and 4 ago, then a renters policy since.
        ...[5, 4].map((m) =>
          tx({ ...insurance("ASSURANT PHONE PROTECTION"), date: monthsAgo(m), amountCents: 1_500 }),
        ),
        ...[3, 2, 1, 0].map((m) =>
          tx({
            ...insurance("ASSURANT RENTERS INSURANCE"),
            date: monthsAgo(m),
            amountCents: 1_500,
          }),
        ),
      ],
      cardProducts: { [CARD.id]: "demo-card" },
    });
    expect(coveredByCard(d, buildStreams(d))).toEqual([]);
  });
});
