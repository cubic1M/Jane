import Link from "next/link";
import { GetStartedButton } from "@/components/get-started-button";
import { AsciiDiamond, DiamondBackground } from "@/components/ascii-diamond";
import { TryButton } from "@/components/try-button";
import { ViewTracker } from "@/components/view-tracker";
import { trialEnabled } from "@/lib/trial";
import { displayFont } from "./fonts";
import "./landing.css";

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
    <main
      className={`${displayFont.variable} landing relative isolate flex w-full flex-1 flex-col overflow-hidden`}
    >
      <ViewTracker event="landing_viewed" />
      {/* The whole page: the art's dotted diamonds (founder, 2026-10-24). */}
      <DiamondBackground />

      <section className="mx-auto grid min-h-[85vh] w-full max-w-6xl grid-cols-1 items-center gap-10 px-6 py-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:py-20">
        {/* The words sit on a panel of the page's own colour, so the dots never cross them. */}
        <div className="-mx-4 flex flex-col gap-7 bg-[var(--landing-bg)]/90 px-4 py-6 sm:-mx-6 sm:px-6">
          <p className="w-fit text-sm text-[var(--landing-dot)]">
            <span aria-hidden="true">[ </span>your money, looked after
            <span aria-hidden="true"> ]</span>
          </p>
          <h1 className="font-display max-w-2xl text-5xl leading-[1.04] font-semibold tracking-tight text-balance text-[var(--landing-hi)] sm:text-7xl">
            See how much money you&apos;re losing
            <span aria-hidden="true" className="ascii-cursor font-mono">
              _
            </span>
          </h1>
          <p className="max-w-xl text-lg text-[var(--landing-mid)]">
            We find the subscriptions, fees, idle cash and interest quietly costing you, and help
            you fix them.
          </p>
          <div className="flex flex-wrap items-center gap-6">
            <GetStartedButton tone="landing" />
            {trialEnabled() && <TryButton />}
            <Link
              href="/login"
              className="font-medium text-[var(--landing-hi)] underline underline-offset-2 hover:no-underline"
            >
              Sign in
            </Link>
          </div>
          <ul
            aria-label="Examples of what Jane does"
            className="flex max-w-md flex-col gap-1 text-sm text-[var(--landing-mid)]"
          >
            {MOMENTS.map((moment) => (
              <li key={moment.label} className="flex items-baseline gap-2">
                <span aria-hidden="true">&gt;</span>
                <span className="shrink-0">{moment.label.toLowerCase()}</span>
                <span
                  aria-hidden="true"
                  className="min-w-4 flex-1 overflow-hidden whitespace-nowrap text-[var(--landing-dot)]"
                >
                  ................................................
                </span>
                <span className="shrink-0 font-semibold text-[var(--landing-hi)] tabular-nums">
                  {moment.amount}
                </span>
                <span className="sr-only">: {moment.detail}</span>
              </li>
            ))}
          </ul>
        </div>
        {/* The picture as ASCII diamonds: beside the words on a wide screen, under them on a phone. */}
        <AsciiDiamond className="mx-auto max-w-[640px]" />
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 pb-20">
        <ul className="grid gap-6 sm:grid-cols-3">
          {POINTS.map((point) => (
            <li
              key={point.title}
              className="flex flex-col gap-1 border border-[var(--landing-dot)]/50 bg-[var(--landing-bg)] p-5"
            >
              <h2 className="font-semibold text-[var(--landing-hi)]">{point.title}</h2>
              <p className="text-sm text-[var(--landing-mid)]">{point.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
