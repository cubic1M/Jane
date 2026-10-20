import Link from "next/link";
import { GetStartedButton } from "@/components/get-started-button";
import { AsciiHeroBackground } from "@/components/ascii-hero-background";
import { TryButton } from "@/components/try-button";
import { ViewTracker } from "@/components/view-tracker";
import { trialEnabled } from "@/lib/trial";

const POINTS = [
  {
    title: "Read-only access",
    body: "We can see your transactions, never move your money.",
  },
  {
    title: "You approve everything",
    body: "Nothing happens until you say yes to it.",
  },
  {
    title: "Delete anytime",
    body: "Disconnect your accounts and erase your data in one step.",
  },
];

// The kind of thing Jane does, shown as a short log under the headline. Examples of the
// product, not results or promises.
const MOMENTS = [
  {
    label: "Refund back",
    detail: "Charged twice at Target",
    amount: "+$64.20",
  },
  {
    label: "Price rise caught",
    detail: "Netflix went from $15.49 to $17.99",
    amount: "$30/yr",
  },
  {
    label: "Jane's pick",
    detail: "A cheaper phone plan, same service",
    amount: "$1,320/yr",
  },
];

// "Try Jane" runs its first scan after the response (src/app/try/actions.ts); this is how
// long that may take.
export const maxDuration = 60;

export default function Home() {
  return (
    <main className="flex w-full flex-1 flex-col">
      <ViewTracker event="landing_viewed" />

      <section className="relative isolate overflow-hidden">
        <AsciiHeroBackground />
        <div className="mx-auto flex min-h-[85vh] w-full max-w-5xl flex-col justify-center gap-7 px-6 py-20">
          <p className="w-fit text-sm text-emerald-700">
            <span aria-hidden="true">[ </span>your money, looked after
            <span aria-hidden="true"> ]</span>
          </p>
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            See how much money you&apos;re losing
            <span aria-hidden="true" className="ascii-cursor text-emerald-700">
              _
            </span>
          </h1>
          <p className="max-w-xl text-lg text-zinc-600 dark:text-zinc-400">
            We find the subscriptions, fees, idle cash and interest quietly costing you, and help
            you fix them.
          </p>
          <div className="flex flex-wrap items-center gap-6">
            <GetStartedButton />
            {trialEnabled() && <TryButton />}
            <Link href="/login" className="font-medium text-emerald-700 hover:underline">
              Sign in
            </Link>
          </div>
          <ul
            aria-label="Examples of what Jane does"
            className="flex max-w-md flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400"
          >
            {MOMENTS.map((moment) => (
              <li key={moment.label} className="flex items-baseline gap-2">
                <span aria-hidden="true" className="text-emerald-700">
                  &gt;
                </span>
                <span className="shrink-0">{moment.label.toLowerCase()}</span>
                <span
                  aria-hidden="true"
                  className="min-w-4 flex-1 overflow-hidden whitespace-nowrap text-zinc-400 dark:text-zinc-600"
                >
                  ................................................
                </span>
                <span className="shrink-0 font-semibold text-emerald-700 tabular-nums">
                  {moment.amount}
                </span>
                <span className="sr-only">: {moment.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 pb-20">
        <ul className="grid gap-6 sm:grid-cols-3">
          {POINTS.map((point) => (
            <li
              key={point.title}
              className="flex flex-col gap-1 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800"
            >
              <h2 className="font-semibold">{point.title}</h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{point.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
