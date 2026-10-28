import { describe, expect, it } from "vitest";
import { INTRADAY_AGENT_EVIDENCE } from "@/config/intraday-agent-evidence";
import { honestLine } from "./honest-line";
import type { EvidenceGroup } from "./report";

const group = (verdicts: string[]): EvidenceGroup =>
  ({
    market: "crypto",
    interval: "15m",
    rows: verdicts.map((verdict) => ({ verdict })),
  }) as unknown as EvidenceGroup;

describe("the agent's honest result", () => {
  it("says none beat holding when none did, with the count from the stored replay", () => {
    const rows = INTRADAY_AGENT_EVIDENCE.flatMap((g) => g.rows);
    const line = honestLine(INTRADAY_AGENT_EVIDENCE);
    expect(line).toContain(`none of the ${rows.length} ways`);
    expect(line).toContain(
      `${rows.filter((r) => r.verdict === "loses_money").length} of them lost money`,
    );
    expect(rows.filter((r) => r.verdict === "beats_hold")).toHaveLength(0);
  });
  it("counts the ones that did, and doesn't promise", () => {
    expect(
      honestLine([group(["beats_hold", "behind_hold", "loses_money", "behind_hold"])]),
    ).toMatch(
      /^In our replay, 1 of the 4 ways .* beat simply holding after costs, and 1 of them lost money\. Past results don't promise/,
    );
  });
  it("says nothing without a replay", () => {
    expect(honestLine([])).toBe("");
  });
});
