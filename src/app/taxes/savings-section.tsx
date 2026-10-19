import Link from "next/link";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import type { TaxSavingsView } from "@/lib/tax-savings";
import { roundDollars } from "@/planning/tax-estimate-copy";
import { SavingButtons } from "./saving-buttons";

// Ways to pay less on /taxes (spec step 122): demo advice, labelled, each with an estimate,
// why, and the one thing to do.

const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";

export function SavingsSection({ view }: { view: TaxSavingsView }) {
  return (
    <section aria-labelledby="savings-heading" id="savings" className={CARD}>
      <h2 id="savings-heading" className="text-xl font-semibold">
        Ways to pay less
      </h2>
      {!view.advice ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Suggestions on paying less tax will come once Jane works with a tax professional. Your
          estimate, tags and forms are all here meanwhile.
        </p>
      ) : view.savings.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Nothing more Jane can see for {view.year} from your accounts.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-4">
            {view.savings.map((s) => (
              <li
                key={s.key}
                className="flex flex-col gap-2 border-t border-zinc-200 pt-3 first:border-0 first:pt-0 dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-semibold">{s.title}</h3>
                  <span className="text-sm whitespace-nowrap">
                    about {roundDollars(s.estimateCents)} a year
                  </span>
                </div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">{s.why}</p>
                {s.action.kind === "link" && (
                  <Link
                    href={s.action.href}
                    className="text-sm font-medium text-emerald-700 hover:underline"
                  >
                    {s.action.label}
                  </Link>
                )}
                <SavingButtons savingKey={s.key} year={view.year} kind={s.action.kind} />
              </li>
            ))}
          </ul>
          <p className="text-xs text-zinc-500">
            Each saving is an estimate from your accounts and the {view.year} tax figures.
          </p>
          <DemoAdviceLabel />
        </>
      )}
    </section>
  );
}
