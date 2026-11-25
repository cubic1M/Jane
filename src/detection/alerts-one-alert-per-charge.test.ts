import { describe, expect, it } from "vitest";
import { onePerCharge, type AlertCandidate } from "./alerts";

// CodeRabbit 1c detn-01 #2: a charge that was both "Charged twice?" and a large charge got both.
const alert = (type: AlertCandidate["type"], key: string): AlertCandidate => ({
  type,
  key,
  title: type,
  body: "",
  confidence: { percent: 80, reason: "test" },
});

describe("onePerCharge, large charge beside 'Charged twice?'", () => {
  it("keeps only 'Charged twice?' when both are about one charge", () => {
    const twice = alert("duplicate_charge", "tx_7");
    const large = alert("large_charge", "tx_7");
    expect(onePerCharge([large, twice])).toEqual([twice]);
  });

  it("keeps the large-charge alert when the duplicate alert is about another charge", () => {
    const twice = alert("duplicate_charge", "tx_8");
    const large = alert("large_charge", "tx_7");
    expect(onePerCharge([large, twice])).toEqual([large, twice]);
  });
});
