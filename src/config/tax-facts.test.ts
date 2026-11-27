import { describe, expect, it } from "vitest";
import {
  LEGACY_DONE_KEY,
  RESIDENCY_FROM_TOLD,
  TAX_FACT_CONFIDENCE,
  TAX_FACT_KEYS,
  TAX_FACT_ORIGINS,
  TAX_FACT_SPECS,
  TOLD_FROM_RESIDENCY,
  isTaxFactKey,
  taxFactSpec,
} from "@/config/tax-facts";

describe("the tax fact keys", () => {
  it("has each key once, and every choice fact lists its choices", () => {
    expect(new Set(TAX_FACT_KEYS).size).toBe(TAX_FACT_KEYS.length);
    for (const s of TAX_FACT_SPECS)
      if (s.type === "choice") expect(s.choices?.length ?? 0).toBeGreaterThan(1);
  });

  it("never holds an identity number, only the flag that it is valid for work", () => {
    expect(TAX_FACT_KEYS.filter((k) => /ssn|itin|ein|account/.test(k))).toEqual([
      "person.ssn_valid_for_work",
      "member.ssn_valid_for_work",
    ]);
    expect(taxFactSpec("person.ssn_valid_for_work").choices).toEqual(["yes", "no", "unknown"]);
  });

  it("gives every origin a confidence, answers strongest", () => {
    for (const origin of TAX_FACT_ORIGINS) expect(TAX_FACT_CONFIDENCE[origin]).toBeGreaterThan(0);
    expect(TAX_FACT_ORIGINS[0]).toBe("answer");
    expect(TAX_FACT_ORIGINS.at(-1)).toBe("legacy");
  });

  it("knows its own keys, and the marker is one of them", () => {
    expect(isTaxFactKey("filing.status")).toBe(true);
    expect(isTaxFactKey("filing.nonsense")).toBe(false);
    expect(isTaxFactKey(LEGACY_DONE_KEY)).toBe(true);
  });

  it("maps a told residency to the record's value and back", () => {
    for (const [told, value] of Object.entries(RESIDENCY_FROM_TOLD))
      expect(TOLD_FROM_RESIDENCY[value]).toBe(told);
    expect(taxFactSpec("residency.status").choices).toEqual(Object.values(RESIDENCY_FROM_TOLD));
  });
});
