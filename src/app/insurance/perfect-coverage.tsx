import Link from "next/link";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { formatCents } from "@/lib/money";
import { insuranceCard } from "@/lib/insurance/need/card";
import { coverEvents } from "@/lib/insurance/cover-changes";
import { openedGaps } from "@/lib/insurance/need/rework";
import { loadNeeds, optionsForNeed } from "@/lib/insurance/need/load";
import type { Need, NeedKind } from "@/lib/insurance/need/types";
import { pickCoverForm } from "./actions";

// Your perfect coverage (spec step 279): what cover they need, what they have and the gap, with
// the same numbers the chat and the nightly detectors use. "See options" opens the pick-one
// card for a need; choosing one queues it for the team. Her pick, and the options themselves,
// are demo advice: a real account sees the need and the gap as facts.

const LABELS: Record<NeedKind, string> = {
  life: "Life cover",
  disability: "Disability cover",
  umbrella: "Umbrella",
  deductible: "Deductible",
  auto_liability: "Car injury liability",
  home_liability: "Home liability",
  renters_liability: "Renters liability",
  business_liability: "Business liability",
  professional_liability: "Professional liability",
  business_equipment: "Work equipment cover",
};
const LINK = "font-medium text-emerald-700 hover:underline";
const BUTTON =
  "inline-flex h-10 items-center rounded-full bg-emerald-700 px-5 text-sm font-semibold text-white hover:bg-emerald-800";

const money = (n: Need, cents: number) =>
  n.unit === "per_month" ? `${formatCents(cents)} a month` : formatCents(cents);

export async function PerfectCoverage({
  userId,
  advice,
  selected,
  policyId,
  result,
}: {
  userId: string;
  advice: boolean;
  selected: string;
  policyId: string;
  result: string;
}) {
  const needs = await loadNeeds(userId);
  if (!needs || needs.length === 0) return null;
  const events = (await coverEvents(userId)).map((e) => e.event);
  const opened = openedGaps(needs, events);
  const open = needs.find((n) => n.kind === selected && (!policyId || n.policyId === policyId));
  const found =
    open && advice
      ? await optionsForNeed(userId, open.kind, { policyId: policyId || undefined })
      : null;
  const card = found ? insuranceCard(found.set, found.need, advice) : null;
  return (
    <section id="options" className="flex flex-col gap-3" aria-labelledby="coverage-h">
      <h2 id="coverage-h" className="text-xl font-semibold">
        Your perfect coverage
      </h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        What cover you need from your own numbers, what you have, and what is missing.
      </p>
      {result && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
        >
          {result}
        </p>
      )}
      {opened.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm" data-testid="opened-gaps">
          {opened.map((g) => (
            <li key={`${g.need.kind}-${g.need.policyId ?? ""}`}>
              Because of {g.because}, your {LABELS[g.need.kind].toLowerCase()} has a gap.{" "}
              {advice && (
                <Link href={`/insurance?need=${g.need.kind}#options`} className={LINK}>
                  See options
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
      <ul className="flex flex-col gap-2">
        {needs.map((n) => {
          const short = n.direction ? n.direction !== "ok" : n.gapCents > 0;
          return (
            <li
              key={`${n.kind}-${n.policyId ?? ""}`}
              className="flex flex-col gap-1 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
            >
              <p className="font-medium">{LABELS[n.kind]}</p>
              <p>{n.summary}</p>
              <p className="text-zinc-600 dark:text-zinc-400">
                You need {money(n, n.needCents)}; you have {money(n, n.haveCents)}.
              </p>
              <details>
                <summary className="cursor-pointer text-zinc-600 dark:text-zinc-400">
                  The working
                </summary>
                <ul className="mt-1">
                  {n.lines.map((l) => (
                    <li key={l.label}>
                      {l.adds ? "+" : "−"} {formatCents(l.cents)}: {l.label}
                    </li>
                  ))}
                </ul>
              </details>
              {short && advice && (
                <Link
                  href={`/insurance?need=${n.kind}${n.policyId ? `&policy=${n.policyId}` : ""}#options`}
                  className={LINK}
                >
                  See options
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {card && open && (
        <div className="flex flex-col gap-3" data-testid="option-card">
          <h3 className="text-lg font-semibold">{card.title}</h3>
          <ul className="flex flex-col gap-3">
            {card.options.map((o) => (
              <li
                key={o.id}
                className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
              >
                <p className="font-medium">
                  {o.headline}
                  {o.isPick && " · Jane's pick"}
                </p>
                <p>{o.whyThisOne}</p>
                <ul className="text-zinc-600 dark:text-zinc-400">
                  {o.facts.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                {o.confidence && (
                  <p className="text-zinc-600 dark:text-zinc-400">
                    {o.confidence.percent}% sure: {o.confidence.reason}.
                  </p>
                )}
                <details>
                  <summary className="cursor-pointer text-zinc-600 dark:text-zinc-400">
                    More details
                  </summary>
                  <ul className="mt-1">
                    {o.details.map((d) => (
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
    </section>
  );
}
