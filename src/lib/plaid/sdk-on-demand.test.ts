import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { StudentLoanStatusTypeEnum, StudentRepaymentPlanTypeEnum } from "plaid";
import { describe, expect, it } from "vitest";
import { LOAN_STATUS_NAMES, REPAYMENT_PLAN_NAMES } from "@/data-sources/plaid/liabilities";

// Plaid's SDK (about 10 MB with axios) loads when Plaid is called, not with every page that reaches
// a file about banks (speed round, 11-15): a cold page render spent ~30 ms loading it. This walks a
// page's static imports, and fails if one brings `import … from "plaid"` (not `import type`) back.
const ROOT = resolve(__dirname, "../../..");
const STATIC_IMPORT = /^(?:import|export)\s+(?!type\s)[^;]*?from\s+["']([^"']+)["']/gm;

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/")
    ? join(ROOT, "src", spec.slice(2))
    : spec.startsWith(".")
      ? resolve(dirname(from), spec)
      : null;
  if (!base) return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const file = base + ext;
    if (/\.(ts|tsx)$/.test(file) && existsSync(file)) return file;
  }
  return null;
}

function importersOfPlaid(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [join(ROOT, entry)];
  const found: string[] = [];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const [, spec] of readFileSync(file, "utf8").matchAll(STATIC_IMPORT)) {
      if (spec === "plaid") found.push(file.slice(ROOT.length + 1));
      const next = resolveImport(file, spec);
      if (next) queue.push(next);
    }
  }
  return found;
}

describe("Plaid's SDK on demand", () => {
  it.each(["src/app/layout.tsx", "src/app/home/page.tsx", "src/app/taxes/page.tsx"])(
    "%s never loads it with the page",
    (entry) => {
      expect(importersOfPlaid(entry)).toEqual([]);
    },
  );

  it("keeps Plaid's own student loan names, written out", () => {
    expect([...REPAYMENT_PLAN_NAMES].sort()).toEqual(
      Object.values(StudentRepaymentPlanTypeEnum).sort(),
    );
    expect([...LOAN_STATUS_NAMES].sort()).toEqual(Object.values(StudentLoanStatusTypeEnum).sort());
  });
});
