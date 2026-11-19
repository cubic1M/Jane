import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// The soft-pull lock (COUNSEL_SOFT_PULL): a real connector asking for a soft credit pull reaches no real
// person until counsel signs off, even when REAL_CONNECTORS lists it. Here REAL_CONNECTORS is made to
// list Method's, to show that on its own it opens nothing.

vi.mock("@/config/connectors", async (original) => ({
  ...(await original<typeof import("@/config/connectors")>()),
  REAL_CONNECTORS: { method_liabilities: true },
}));

import { COUNSEL_SOFT_PULL } from "@/config/connectors";
import { methodLiabilities, sandboxMethodLiabilities } from "./method/connector";
import { allConnectors, whyUnavailable } from "./registry";

const on = { CONNECTORS: "1" };
const real = { userId: "user_real", sampleData: false };
const sample = { userId: "user_sample", sampleData: true };

describe("the soft-pull lock", () => {
  it("holds Method's real connector back from a real person, even listed in REAL_CONNECTORS", () => {
    expect(COUNSEL_SOFT_PULL.approved).toBe(false);
    expect(methodLiabilities.scopes).toContain("soft_credit_pull");
    expect(whyUnavailable(methodLiabilities, real, on)).toBe("needs_counsel");
  });

  it("leaves the sandbox twin, which asks for no pull, to sample people", () => {
    expect(sandboxMethodLiabilities.scopes).not.toContain("soft_credit_pull");
    expect(whyUnavailable(sandboxMethodLiabilities, sample, on)).toBeNull();
  });

  it("holds every registered real connector that asks for a soft pull", () => {
    const pulls = allConnectors().filter(
      (c) => !c.sandbox && c.scopes.includes("soft_credit_pull"),
    );
    expect(pulls.map((c) => c.id)).toContain("method_liabilities");
    for (const c of pulls) expect(whyUnavailable(c, real, on)).toBe("needs_counsel");
  });

  it("is code, never an env var", () => {
    const config = readFileSync("src/config/connectors.ts", "utf8");
    const block = config.slice(config.indexOf("export const COUNSEL_SOFT_PULL"));
    expect(block.slice(0, block.indexOf("};"))).not.toMatch(/process\.env|env\[/);
  });
});
