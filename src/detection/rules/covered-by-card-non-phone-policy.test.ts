import { describe, expect, it } from "vitest";
import { CARD, input, monthly } from "../__fixtures__/build";
import { buildStreams } from "../streams";
import type { DetectionInput } from "../types";
import { coveredByCard } from "./covered-by-card";

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
const run = (description: string) => {
  const d: DetectionInput = input({
    transactions: [...monthly(4, 14_500, phoneBill), ...monthly(4, 1_500, insurance(description))],
    cardProducts: { [CARD.id]: "demo-card" },
  });
  return coveredByCard(d, buildStreams(d));
};

describe("a phone word in another kind of policy is not phone protection", () => {
  it("does not call a mobile home policy covered by the card", () => {
    expect(run("ASSURANT MOBILE HOME INSURANCE")).toEqual([]);
  });

  it("still takes Assurant phone protection, and a device plan", () => {
    expect(run("ASSURANT PHONE PROTECTION")).toHaveLength(1);
    expect(run("ASSURANT CELLULAR DEVICE PLAN")).toHaveLength(1);
  });
});
