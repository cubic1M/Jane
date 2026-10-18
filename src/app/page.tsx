import Link from "next/link";
import { GetStartedButton } from "@/components/get-started-button";
import { MoneySurfaceLazy } from "@/components/money-surface-lazy";
import { ViewTracker } from "@/components/view-tracker";

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

// The kind of thing Jane does, shown as small cards beside the headline. Examples of the
// product, not results or promises.
const MOMENTS = [
  {
    label: "Refund back",
    detail: "Charged twice at Target",
    amount: "+$64.20",
    position: "right-0 top-6",
  },
  {
    label: "Price rise caught",
    detail: "Netflix went from $15.49 to $17.99",
    amount: "$30/yr",
    position: "-right-6 top-40",
  },
  {
    label: "Jane's pick",
    detail: "A cheaper phone plan, same service",
    amount: "$1,320/yr",
    position: "right-10 top-72",
  },
];

export default function Home() {
  return (
    <main className="flex w-full flex-1 flex-col">
      <ViewTracker event="landing_viewed" />

      <section className="relative isolate overflow-hidden">
        <MoneySurfaceLazy className="-z-10" />
        {/* Keeps the words readable over the wave. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-gradient-to-b from-[var(--background)] from-15% via-[var(--background)]/40 via-40% to-transparent to-60%"
        />
        <div className="mx-auto grid min-h-[80vh] w-full max-w-5xl items-center gap-10 px-6 py-20 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex flex-col gap-6">
            <p className="w-fit rounded-full border border-emerald-700/30 bg-emerald-50/80 px-3 py-1 text-sm font-medium text-emerald-800 backdrop-blur dark:border-emerald-400/30 dark:bg-emerald-950/60">
              Your money, looked after
            </p>
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
              See how much money you&apos;re losing
            </h1>
            <p className="max-w-xl text-lg text-zinc-600 dark:text-zinc-400">
              We find the subscriptions, fees, idle cash and interest quietly costing you, and help
              you fix them.
            </p>
            <div className="flex flex-wrap items-center gap-6">
              <GetStartedButton />
              <Link href="/login" className="font-medium text-emerald-700 hover:underline">
                Sign in
              </Link>
            </div>
          </div>

          <ul aria-label="Examples of what Jane does" className="relative hidden h-96 lg:block">
            {MOMENTS.map((moment) => (
              <li
                key={moment.label}
                className={`absolute ${moment.position} w-64 rounded-2xl border border-zinc-200 bg-white/85 p-4 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
                    {moment.label}
                  </span>
                  <span className="font-semibold text-emerald-700 tabular-nums">
                    {moment.amount}
                  </span>
                </div>
                <p className="mt-1 text-sm">{moment.detail}</p>
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
