import Link from "next/link";
import { ComparisonCards } from "@/components/comparison-cards";
import { toComparison } from "@/lib/comparison";
import { formatCents } from "@/lib/money";
import { itemId } from "@/lib/area-pages/insurance";
import { isShort, needKey, type Coverage } from "@/lib/area-pages/insurance-coverage";
import type { Need } from "@/lib/insurance/need/types";

// Your perfect coverage (spec step 279): what cover they need, what they have and the gap, with
// the same numbers the chat and the nightly detectors use. On the area tree each need is an
// item (docs/design/area-pages.md); "See options" opens the options as comparison cards, and
// choosing one queues it for the team. Her pick, and the options themselves, are demo advice: a real
// account sees the need and the gap as facts.

const LINK = "font-medium text-emerald-700 hover:underline";

// A need's item on the tree: "See options" (demo advice only), and the options card once asked.
export function NeedDetail({
  need,
  coverage,
  advice,
  policyId,
}: {
  need: Need;
  coverage: Coverage;
  advice: boolean;
  policyId: string;
}) {
  const card = coverage.open && needKey(coverage.open) === needKey(need) ? coverage.card : null;
  // The options side by side (src/components/comparison-cards.tsx); a pick queues it for the team.
  const comparison = card ? toComparison({ ...card, ...(policyId ? { policyId } : {}) }) : null;
  return (
    <div className="flex flex-col gap-3 text-sm">
      {isShort(need) && advice && !card && (
        <Link
          href={`/insurance?need=${need.kind}${need.policyId ? `&policy=${need.policyId}` : ""}&focus=${encodeURIComponent(itemId("needs", needKey(need)))}#options`}
          className={LINK}
        >
          See options
        </Link>
      )}
      {comparison && (
        <div id="options" data-testid="option-card">
          <ComparisonCards comparison={comparison} />
        </div>
      )}
    </div>
  );
}

// The working behind a need, for "More".
export function NeedWorking({ need }: { need: Need }) {
  return (
    <ul className="text-zinc-600 dark:text-zinc-400">
      <li>{need.summary}</li>
      {need.lines.map((l) => (
        <li key={l.label}>
          {l.adds ? "+" : "−"} {formatCents(l.cents)}: {l.label}
        </li>
      ))}
    </ul>
  );
}
