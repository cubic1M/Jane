import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { categoryOf, PFC_TAXONOMY } from "@/categorize/taxonomy";
import * as config from "./detection";

const CATEGORY_LISTS = {
  SUBSCRIPTION_CATEGORIES: config.SUBSCRIPTION_CATEGORIES,
  PRICE_INCREASE_EXCLUDED_CATEGORIES: config.PRICE_INCREASE_EXCLUDED_CATEGORIES,
  BANK_FEE_CATEGORIES: config.BANK_FEE_CATEGORIES,
  CARD_INTEREST_CATEGORIES: config.CARD_INTEREST_CATEGORIES,
  INSURANCE_CATEGORIES: config.INSURANCE_CATEGORIES,
  NON_SPENDING_CATEGORIES: config.NON_SPENDING_CATEGORIES,
  SERVICE_GROUPS: config.SERVICE_GROUPS.flatMap((g) => g.categories),
};

describe("detection config", () => {
  it.each(Object.entries(CATEGORY_LISTS))("%s uses real Plaid PFCv2 names", (_name, list) => {
    for (const detailed of list) expect(categoryOf(detailed), detailed).not.toBeNull();
  });

  it("uses real Plaid primary categories", () => {
    for (const primary of [
      ...config.PRICE_INCREASE_EXCLUDED_PRIMARIES,
      ...config.NON_SPENDING_PRIMARIES,
    ]) {
      expect(Object.keys(PFC_TAXONOMY)).toContain(primary);
    }
  });

  it("covers every Plaid bank-fee category between bank fees and card interest", () => {
    expect([...config.BANK_FEE_CATEGORIES, ...config.CARD_INTEREST_CATEGORIES].sort()).toEqual(
      [...PFC_TAXONOMY.BANK_FEES].sort(),
    );
  });
});

// Acceptance criterion: no threshold or rate appears outside src/config/detection.ts.
// Any number other than 0 or 1 written in detection code fails this test. units.ts holds
// calendar facts (days per month, basis points) and is the one exception.
describe("detection code", () => {
  const root = join(process.cwd(), "src/detection");
  const files = (readdirSync(root, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .filter((f) => !f.startsWith("__fixtures__") && f !== "units.ts")
    .map((f) => join(root, f));

  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(8);
  });

  it.each(files.map((f) => [relative(root, f), f]))("%s has no inline numbers", (_name, file) => {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest);
    const numbers: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isNumericLiteral(node) && !["0", "1"].includes(node.text)) numbers.push(node.text);
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(numbers).toEqual([]);
  });
});
