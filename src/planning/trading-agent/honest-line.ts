import type { EvidenceGroup } from "./report";

// The 24-hour agent's honest result, in plain words, counted from its stored replay
// (src/config/intraday-agent-evidence.ts), never typed by hand: how many of the settings tried
// beat simply holding after costs. Shown on the agent's section so nobody takes it for a way to
// make money. Pure.

export function honestLine(groups: readonly EvidenceGroup[]): string {
  const rows = groups.flatMap((g) => g.rows);
  const beat = rows.filter((r) => r.verdict === "beats_hold").length;
  const lost = rows.filter((r) => r.verdict === "loses_money").length;
  if (rows.length === 0) return "";
  if (beat === 0) {
    return `In our replay, none of the ${rows.length} ways the agent could trade beat simply holding after costs, and ${lost} of them lost money. It runs on practice money so you can watch what trading every few minutes does.`;
  }
  return `In our replay, ${beat} of the ${rows.length} ways the agent could trade beat simply holding after costs, and ${lost} of them lost money. Past results don't promise the next ones.`;
}
