import { CATALOG, CATALOG_IDS, type CatalogFamily } from "@/config/strategy-catalog";

// docs/backtests/strategy-catalog.md, written from the catalog itself (src/config/
// strategy-catalog.ts), so the two never disagree: each strategy's source, rules, setting and
// funds. Pure.

const FAMILIES: Readonly<Record<CatalogFamily, string>> = {
  static: "Fixed mixes",
  tactical: "Tactical asset allocation",
  risk: "Risk-based allocation",
  factor: "Factor tilts",
  trend: "Trend following",
  rotation: "Rotation",
  protection: "Volatility and drawdown control",
  seasonal: "Seasonality",
  reversion: "Mean reversion",
};

const KINDS = {
  equity: "replaces the level mix's US-stocks share",
  portfolio: "a whole portfolio, blended with bills to the level's volatility",
  sleeve: "a 10% sleeve taken from the mix's bonds",
} as const;

export function catalogMarkdown(): string {
  const lines = [
    "# Strategy catalog",
    "",
    "Every well-documented, rules-based strategy we found, written as the rules the replay runs. Generic versions of public concepts with liquid ETF proxies; nothing from paid material. The results are in [strategy-results.md](strategy-results.md). Generated from `src/config/strategy-catalog.ts`.",
    "",
    "Also tested, separately and at Very high only: the five day-trading rules on 5-minute bars (`src/config/intraday-strategies.ts`, `src/config/intraday-evidence.ts`) and the three crypto rules (`src/config/crypto-strategies.ts`, `src/config/crypto-evidence.ts`).",
    "",
  ];
  for (const family of Object.keys(FAMILIES) as CatalogFamily[]) {
    const ids = CATALOG_IDS.filter((id) => CATALOG[id].family === family);
    if (ids.length === 0) continue;
    lines.push(`## ${FAMILIES[family]}`, "");
    for (const id of ids) {
      const e = CATALOG[id];
      lines.push(
        `### ${e.label} (\`${id}\`)`,
        "",
        `- **Source:** [${e.source.title}](${e.source.url})`,
        `- **Rules:** ${e.rules}`,
        `- **Setting:** ${e.param === "none" ? "none" : `${e.param}: ${e.grid.join(", ")}`}`,
        `- **Funds:** ${e.tickers.join(", ")}`,
        `- **At each level:** ${KINDS[e.kind]}`,
        "",
      );
    }
  }
  return lines.join("\n");
}
