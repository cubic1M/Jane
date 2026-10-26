import type { Bucket } from "@/planning/goal-buckets";
import { formatPercent as pct } from "@/lib/percent";

// Jane's words about investing by goal (spec step 157). Pure.

export const bucketLine = (b: Bucket) =>
  b.nearTerm
    ? `${b.name} (${b.yearsLeft < 1 ? "under a year" : `${Math.round(b.yearsLeft)} years`} away): cash, never stocks`
    : `${b.name} (${Math.round(b.yearsLeft)} years away): ${pct(b.mix.us_stocks + b.mix.intl_stocks)} stocks`;

export const byHerselfLine = (byHerself: boolean) =>
  byHerself
    ? "New money from automatic investing goes to each goal by itself, near-term goals first."
    : "Choose “Handle the safe stuff” and I'll split new money by goal by myself.";
