import Link from "next/link";
import { preload } from "react-dom";
import { GetStartedButton } from "@/components/get-started-button";
import { ColumnArt } from "@/components/column-art";
import { COLUMN_IMAGE } from "@/lib/column-art";
import { TryButton } from "@/components/try-button";
import { ViewTracker } from "@/components/view-tracker";
import { trialEnabled } from "@/lib/trial";
import { displayFont } from "./fonts";
import "./landing.css";
import { LandingModeSwitch } from "./landing-mode-switch";
import { LandingTheme } from "./landing-theme";

const POINTS = [
  {
    title: "Read-only access",
    body: "Jane sees your transactions and can never move your money.",
  },
  {
    title: "You stay in charge",
    body: "Nothing happens until you say yes.",
  },
  {
    title: "Delete anytime",
    body: "Disconnect and erase everything in one step.",
  },
];

// The kind of thing Jane does, shown as a short log under the headline. Examples of the
// product, not results or promises.
const MOMENTS = [
  {
    label: "Card interest cut",
    detail: "A $14,000 balance at 27%, and a cheaper way to pay it down",
    amount: "$2,310/yr",
  },
  {
    label: "Idle cash put to work",
    detail: "$40,000 sitting in checking, earning nothing",
    amount: "$1,840/yr",
  },
  {
    label: "Car insurance compared",
    detail: "The same cover from another insurer",
    amount: "$612/yr",
  },
  {
    label: "Forgotten subscriptions",
    detail: "Four services nobody had opened in months",
    amount: "$486/yr",
  },
];

// The sum of the examples above, shown as the log's last line.
const MOMENTS_TOTAL = "$5,248/yr";

// The story the pillar is rebuilt along, one beat per screen (founder, 2026-10-25).
const BEATS = [
  {
    tag: "the leak",
    title: "Money leaks quietly",
    body: "Subscriptions you forgot, fees you never agreed to, cash earning nothing, interest working against you.",
  },
  {
    tag: "the read",
    title: "Jane reads all of it",
    body: "Every account and transaction, linked read-only. Your net worth drawn day by day, with a dot for every dollar that moved.",
  },
  {
    tag: "the find",
    title: "Jane brings it to you, unasked",
    body: "Price rises, double charges, idle cash, a plan that costs more than one just as good. Each one a card with what it's worth and how sure Jane is.",
  },
  {
    tag: "the fix",
    title: "You decide. Jane does the legwork",
    body: "Say yes and Jane hands you the steps, the email and the phone script, ready to go. After, it checks the saving really happened.",
  },
  {
    tag: "ask",
    title: "Ask Jane anything",
    body: "Type or talk. Jane answers from your own numbers, not a script.",
  },
  {
    tag: "the whole picture",
    title: "Every part of your money",
    body: "Spending and bills, insurance and loans compared side by side, taxes, and investing strategies tested on decades of history, in one place.",
  },
];

// "Try Jane" runs its first scan after the response (src/app/try/actions.ts); this is how
// long that may take.
export const maxDuration = 60;

export default function Home() {
  // The column's drawing starts downloading with the page, not after the script that draws it.
  preload(COLUMN_IMAGE, { as: "image" });
  return (
    <main
      className={`${displayFont.variable} landing relative isolate flex w-full flex-1 flex-col`}
    >
      <LandingTheme />
      <LandingModeSwitch />
      <ViewTracker event="landing_viewed" />
      <div className="relative mx-auto grid w-full max-w-7xl grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* The column (founder, 2026-10-25): fixed to the screen while the story scrolls, panning
            from its broken capital at the top of the page down to its whole base at the bottom.
            The right of a wide screen; behind the words, faint, on a phone. */}
        <div className="pillar-dock pointer-events-none fixed inset-0 -z-10 overflow-hidden lg:left-[47%] lg:px-4">
          <ColumnArt />
        </div>

        <div className="flex flex-col px-6 lg:col-start-1 lg:row-start-1">
          <section id="start" className="flex min-h-dvh flex-col justify-center py-16">
            <div className="landing-panel flex flex-col gap-7">
              <p className="w-fit text-sm text-[var(--landing-dot)]">
                <span aria-hidden="true">[ </span>your financial controller
                <span aria-hidden="true"> ]</span>
              </p>
              <h1 className="font-display max-w-2xl text-5xl leading-[1.04] font-normal text-balance text-[var(--landing-hi)] sm:text-7xl">
                See how much money you&apos;re losing
                <span aria-hidden="true" className="ascii-cursor font-mono">
                  _
                </span>
              </h1>
              <p className="max-w-xl text-lg text-[var(--landing-mid)]">
                Jane reads every account, finds what&apos;s costing you, and hands you the fix, from
                a forgotten subscription to a cheaper loan.
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
              <p className="-mb-5 text-xs text-[var(--landing-dot)]">an example scan</p>
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
                <li className="mt-1 flex items-baseline gap-2 border-t border-dashed border-[var(--landing-dot)] pt-2">
                  <span aria-hidden="true">=</span>
                  <span className="shrink-0">found, a year</span>
                  <span
                    aria-hidden="true"
                    className="min-w-4 flex-1 overflow-hidden whitespace-nowrap text-[var(--landing-dot)]"
                  >
                    ................................................
                  </span>
                  <span className="shrink-0 text-base font-semibold text-[var(--landing-hi)] tabular-nums">
                    {MOMENTS_TOTAL}
                  </span>
                </li>
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
                <h2 className="font-display text-5xl leading-tight font-normal text-[var(--landing-hi)] sm:text-6xl">
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
              <h2 className="font-display text-5xl leading-tight font-normal text-[var(--landing-hi)] sm:text-7xl">
                Put your money back together
              </h2>
              <p className="text-lg text-[var(--landing-mid)]">
                Jane is in an invite-only beta. Link a bank with your invite, or try Jane with a
                sample person in seconds.
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
