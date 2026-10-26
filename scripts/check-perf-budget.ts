// `npm run check:perf-budget` after `npm run build`: fails when a main page's first-load JS is
// over its number in src/config/perf-budget.json. Prints sizes only.
import { readFileSync } from "node:fs";
import { checkBudget, describeRow, type RouteStat } from "../src/lib/perf-budget.ts";

const stats: RouteStat[] = JSON.parse(
  readFileSync(".next/diagnostics/route-bundle-stats.json", "utf8"),
);
const budget = JSON.parse(readFileSync("src/config/perf-budget.json", "utf8"));

const rows = checkBudget(stats, budget);
for (const row of rows) console.log(describeRow(row));
const failed = rows.filter((r) => !r.ok);
console.log(
  failed.length ? `\n${failed.length} page(s) over budget.` : "\nAll pages within budget.",
);
process.exit(failed.length ? 1 : 0);
