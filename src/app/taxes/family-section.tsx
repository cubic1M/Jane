import Link from "next/link";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import type { FamilyView } from "@/lib/family-taxes";
import { roundDollars } from "@/planning/tax-estimate-copy";

// Family taxes on /taxes (spec step 169, demo advice): each choice with both sides'
// federal tax, which sides are open (with the rules), and what Jane assumed.

const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";

export function FamilySection({ view }: { view: FamilyView }) {
  if (!view.advice) return null;
  return (
    <section aria-labelledby="family-heading" id="family" className={CARD}>
      <h2 id="family-heading" className="text-xl font-semibold">
        Family tax choices
      </h2>
      {view.choices.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No family choices for {view.year} from what Jane knows.{" "}
          <Link href="/taxes/profile#family" className="text-emerald-700 underline">
            Add family details
          </Link>
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {view.choices.map((c) => (
            <li
              key={c.key}
              className="flex flex-col gap-2 border-t border-zinc-200 pt-3 first:border-0 first:pt-0 dark:border-zinc-800"
            >
              <h3 className="font-semibold">{c.title}</h3>
              <table className="w-full text-sm">
                <caption className="sr-only">{c.title}: each side&apos;s federal tax</caption>
                <tbody>
                  {c.sides.map((s, i) => (
                    <tr key={s.label} className="border-t border-zinc-200 dark:border-zinc-800">
                      <th scope="row" className="py-1 pr-2 text-left font-normal">
                        {s.label}
                        {c.better === i && (
                          <strong className="ml-2 text-emerald-700">Less tax</strong>
                        )}
                        <span className="block text-xs text-zinc-600 dark:text-zinc-400">
                          {s.eligible ? s.why.join(" ") : `Not open to you: ${s.why.join(" ")}`}
                        </span>
                      </th>
                      <td className="py-1 text-right whitespace-nowrap">
                        {s.eligible ? roundDollars(s.taxCents) : "n/a"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </li>
          ))}
        </ul>
      )}
      {view.assumptions.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-zinc-600 dark:text-zinc-400">
          {view.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        Federal tax for {view.year}, estimated; a 529&apos;s figures include your state tax.
        Choosing is yours.{" "}
        <Link href="/taxes/profile#family" className="text-emerald-700 underline">
          Family details
        </Link>
      </p>
      <DemoAdviceLabel />
    </section>
  );
}
