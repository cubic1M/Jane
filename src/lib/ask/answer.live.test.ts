import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

vi.mock("./tools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./tools")>()),
  runAskTool: vi.fn(async (_userId: string, name: string) =>
    name === "spending_by_category"
      ? {
          content: JSON.stringify({
            month: "2026-09",
            spending: "$1,204.55",
            income: "$4,100.00",
            categories: [
              { category: "Food and drink", amount: "$412.30" },
              { category: "Shopping", amount: "$300.00" },
            ],
          }),
          cents: [120_455, 410_000, 41_230, 30_000],
        }
      : { content: "{}", cents: [] },
  ),
}));

import { askJane } from "./answer";

// Calls the real Claude API with the real tool definitions (tool results are canned).
// Opt in: ASK_LIVE_TEST=1 ANTHROPIC_API_KEY=... npx vitest run src/lib/ask/answer.live.test.ts
describe.runIf(process.env.ASK_LIVE_TEST === "1" && process.env.ANTHROPIC_API_KEY)(
  "Ask Jane against the real Claude API",
  () => {
    it(
      "looks up spending with a tool and answers with its figure",
      { timeout: 120_000 },
      async () => {
        const statuses: string[] = [];
        const result = await askJane("u1", [], "How much did I spend on food in September 2026?", {
          onStatus: (s) => statuses.push(s),
        });

        expect(statuses.length).toBeGreaterThan(0);
        expect(result.kind).toBe("answer");
        expect(result.text).toContain("$412.30");
      },
    );
  },
);
