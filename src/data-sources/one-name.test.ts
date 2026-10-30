import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// One merchant-name cleaner (card-chat mismatch): a name shown on a surface comes from the merchant
// directory and normalizeMerchant (src/data-sources/merchant.ts, src/detection/merchants.ts
// namedByDirectory), so the chat's search finds what a card names. The founder's /deadlines said
// "Amc Online -- Ks 12/06" from a home-made cleaner (price rises' payeeOf) while the chat looked
// for something else. This fails when a new module builds a name from a raw description itself.
//
// The ones there already, each with why; move one to the shared cleaner and take it off.
const ALLOWED: Readonly<Record<string, string>> = {
  "src/planning/price-rises.ts":
    "payeeOf: only when no merchant name is passed in (the suggestion detector's profile rows)",
  "src/planning/costly-borrowing.ts": "a lender's name from a loan deposit's words, not a merchant",
  "src/planning/money-for-two.ts": "a payer's name from a paycheck's words, not a merchant",
  "src/profile/build.ts": "an employer's name from a paycheck's words, not a merchant",
  "src/detectors/life.ts": "an employer's name from a paycheck's words, not a merchant",
  "src/detectors/helpers.ts": "the detectors' profile rows carry no merchant name yet",
  "src/lib/memory/from-data.ts": "a fact's label, trimmed to length, not a merchant name",
  "src/lib/insurance/claim-filing.ts": "the person's own claim description, not a bank name",
};

// A description cleaned into something else, on the same or the next line.
const OWN_CLEANER = /\bdescription\b\s*(?:\n\s*)?\.(?:replace|split)\(/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__fixtures__" || name === "generated" ? [] : files(path);
    }
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("one merchant-name cleaner", () => {
  const offenders = files("src")
    .filter((p) => !p.startsWith("src/accuracy/") && !p.startsWith("src/data-sources/"))
    .filter((p) => OWN_CLEANER.test(readFileSync(p, "utf8")));

  it("has no module building its own name from a description", () => {
    expect(
      offenders.filter((p) => !(p in ALLOWED)),
      "use normalizeMerchant / namedByDirectory (or loadTransactionsBetween's names)",
    ).toEqual([]);
  });

  it("lists none that no longer do", () => {
    expect(Object.keys(ALLOWED).filter((p) => !offenders.includes(p))).toEqual([]);
  });
});
