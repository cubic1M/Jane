import Link from "next/link";
import { GetStartedButton } from "@/components/get-started-button";
import { ColumnArt } from "@/components/column-art";
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

// The story the pillar is rebuilt along, one beat per screen (founder, 2026-10-25).
const BEATS = [
  {
    tag: "the leak",
    title: "Money leaks quietly",
    body: "Subscriptions you forgot, fees you never agreed to, cash earning nothing, interest that compounds against you.",
  },
  {
    tag: "the read",
    title: "Jane reads all of it",
    body: "Every account, every transaction, every bill and policy, every day.",
  },
  {
    tag: "the find",
    title: "She finds what you'd miss",
    body: "A price that crept up, a charge made twice, a plan that costs more than one just as good.",
  },
  {
    tag: "the fix",
    title: "One card, one decision",
    body: "What it's worth, how sure she is, and the fix, ready for your yes.",
  },
  {
    tag: "the whole picture",
    title: "Every part of your money",
    body: "Spending and bills, insurance, loans, taxes, investing and your goals, in one place.",
  },
];

// "Try Jane" runs its first scan after the response (src/app/try/actions.ts); this is how
// long that may take.
export const maxDuration = 60;

export default function Home() {
  return (
    <main
      className={`${displayFont.variable} landing relative isolate flex w-full flex-1 flex-col`}
    >
      <ViewTracker event="landing_viewed" />
      <div className="relative mx-auto grid w-full max-w-7xl grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* The column (founder, 2026-10-25): fixed to the screen while the story scrolls, panning
            from its cracked capital at the top of the page down to its whole base at the bottom.
            The right half of a wide screen; behind the words, faint, on a phone. */}
        <div className="pillar-dock pointer-events-none fixed inset-0 -z-10 lg:left-1/2 lg:px-10 lg:py-0">
          <ColumnArt />
        </div>

        <div className="flex flex-col px-6 lg:col-start-1 lg:row-start-1">
          <section id="start" className="flex min-h-dvh flex-col justify-center py-16">
            <div className="landing-panel flex flex-col gap-7">
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
                We find the subscriptions, fees, idle cash and interest quietly costing you, and
                help you fix them.
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
              <p aria-hidden="true" className="text-sm text-[var(--landing-dot)]">
                scroll ↓
              </p>
            </div>
          </section>

          {BEATS.map((beat) => (
            <section key={beat.title} className="flex min-h-[80dvh] flex-col justify-center py-16">
              <div className="landing-panel flex max-w-xl flex-col gap-4">
                <p className="text-sm text-[var(--landing-dot)]">
                  <span aria-hidden="true">[ </span>
                  {beat.tag}
                  <span aria-hidden="true"> ]</span>
                </p>
                <h2 className="font-display text-4xl leading-tight font-semibold text-[var(--landing-hi)] sm:text-5xl">
                  {beat.title}
                </h2>
                <p className="text-lg text-[var(--landing-mid)]">{beat.body}</p>
              </div>
            </section>
          ))}

          <section className="flex min-h-[80dvh] flex-col justify-center py-16">
            <ul className="landing-panel flex max-w-xl flex-col gap-6">
              {POINTS.map((point) => (
                <li
                  key={point.title}
                  className="flex flex-col gap-1 border border-dashed border-[var(--landing-dot)] p-5"
                >
                  <h2 className="font-semibold text-[var(--landing-hi)]">{point.title}</h2>
                  <p className="text-sm text-[var(--landing-mid)]">{point.body}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="flex min-h-dvh flex-col justify-center py-16">
            <div className="landing-panel flex max-w-xl flex-col gap-5">
              <p className="text-sm text-[var(--landing-dot)]">
                <span aria-hidden="true">[ </span>rebuilt
                <span aria-hidden="true"> ]</span>
              </p>
              <h2 className="font-display text-4xl leading-tight font-semibold text-[var(--landing-hi)] sm:text-6xl">
                Put your money back together
              </h2>
              <p className="text-lg text-[var(--landing-mid)]">
                Link a bank, or try Jane with a sample person in a few seconds.
              </p>
              <a
                href="#start"
                className="w-fit font-medium text-[var(--landing-hi)] underline underline-offset-2 hover:no-underline"
              >
                Start now ↑
              </a>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
