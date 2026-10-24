import Link from "next/link";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { formatCents } from "@/lib/money";
import { itemId } from "@/lib/area-pages/insurance";
import { insuranceCard } from "@/lib/insurance/need/card";
import { coverEvents } from "@/lib/insurance/cover-changes";
import { openedGaps } from "@/lib/insurance/need/rework";
import { loadNeeds, optionsForNeed } from "@/lib/insurance/need/load";
import type { Need } from "@/lib/insurance/need/types";
import { pickCoverForm } from "./actions";

// Your perfect coverage (spec step 279): what cover they need, what they have and the gap, with
// the same numbers the chat and the nightly detectors use. On the area tree each need is an
// item (docs/design/area-pages.md); "See options" opens the pick-one card for it, and choosing
// one queues it for the team. Her pick, and the options themselves, are demo advice: a real
// account sees the need and the gap as facts.

const LINK = "font-medium text-emerald-700 hover:underline";
const BUTTON =
  "inline-flex h-10 items-center rounded-full bg-emerald-700 px-5 text-sm font-semibold text-white hover:bg-emerald-800";

export const needKey = (n: Pick<Need, "kind" | "policyId">) =>
  `${n.kind}${n.policyId ? `-${n.policyId}` : ""}`;

export const isShort = (n: Need) => (n.direction ? n.direction !== "ok" : n.gapCents > 0);

export type Coverage = Awaited<ReturnType<typeof loadCoverage>>;

// The needs, which of them a life event opened, and the options card for the one asked for.
export async function loadCoverage(
  userId: string,
  { advice, selected, policyId }: { advice: boolean; selected: string; policyId: string },
) {
  const needs = (await loadNeeds(userId)) ?? [];
  if (needs.length === 0) return { needs, opened: new Set<string>(), card: null, open: null };
  const events = (await coverEvents(userId)).map((e) => e.event);
  const opened = new Set(openedGaps(needs, events).map((g) => needKey(g.need)));
  const open = needs.find((n) => n.kind === selected && (!policyId || n.policyId === policyId));
  const found =
    open && advice
      ? await optionsForNeed(userId, open.kind, { policyId: policyId || undefined })
      : null;
  const card = found ? insuranceCard(found.set, found.need, advice) : null;
  return { needs, opened, card, open: open ?? null };
}

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
      {card && (
        <div id="options" className="flex flex-col gap-3" data-testid="option-card">
          <h3 className="text-base font-semibold">{card.title}</h3>
          <ul className="flex flex-col gap-3">
            {card.options.map((o) => (
              <li
                key={o.id}
                className="flex flex-col gap-2 border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <p className="font-medium">
                  {o.headline}
                  {o.isPick && " · Jane's pick"}
                </p>
                <p>{o.whyThisOne}</p>
                {o.confidence && (
                  <p className="text-zinc-600 dark:text-zinc-400">
                    {o.confidence.percent}% sure: {o.confidence.reason}.
                  </p>
                )}
                <details>
                  <summary className="cursor-pointer text-zinc-600 dark:text-zinc-400">
                    More
                  </summary>
                  <ul className="mt-1 text-zinc-600 dark:text-zinc-400">
                    {[...o.facts, ...o.details].map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </details>
                <form action={pickCoverForm}>
                  <input type="hidden" name="need" value={card.topic} />
                  <input type="hidden" name="option" value={o.id} />
                  <input type="hidden" name="policy" value={policyId} />
                  <button type="submit" className={BUTTON}>
                    Choose this one
                  </button>
                </form>
              </li>
            ))}
          </ul>
          <DemoAdviceLabel />
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
