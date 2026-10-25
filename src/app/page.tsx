import Link from "next/link";
import { GetStartedButton } from "@/components/get-started-button";
import { PillarStory } from "@/components/pillar-story";
import { TryButton } from "@/components/try-button";
import { ViewTracker } from "@/components/view-tracker";
import { trialEnabled } from "@/lib/trial";
import { displayFont } from "./fonts";

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

// The kind of thing Jane does, one beat each. Examples of the product, not results or promises.
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

// One beat of the story: about a screen tall, its words on a scrim so they read over the pillar on
// a phone (on a computer the pillar is beside them).
function Beat({ children, last = false }: { children: React.ReactNode; last?: boolean }) {
  return (
    <section className={`flex items-center py-10 ${last ? "min-h-dvh" : "min-h-[90dvh]"}`}>
      <div className="flex w-full max-w-xl flex-col gap-5 bg-[var(--background)]/85 p-4 backdrop-blur-[1px] sm:p-6 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
        {children}
      </div>
    </section>
  );
}

const EYEBROW = "w-fit text-sm text-zinc-600 dark:text-zinc-400";

// The landing page (founder, 2026-10-25): the story in eight beats beside an ASCII Roman column
// that rebuilds itself as it scrolls (src/components/pillar-story.tsx), broken at the top and
// whole beside "Try it with sample data" at the bottom.
export default function Home() {
  return (
    <main className={`${displayFont.variable} relative flex w-full flex-1 flex-col`}>
      <ViewTracker event="landing_viewed" />
      <PillarStory>
        <Beat>
          <p className={EYEBROW}>
            <span aria-hidden="true">[ </span>your money, looked after
            <span aria-hidden="true"> ]</span>
          </p>
          <h1 className="font-display max-w-2xl text-5xl leading-[1.04] font-semibold tracking-tight text-balance sm:text-7xl">
            See how much money you&apos;re losing
            <span aria-hidden="true" className="ascii-cursor font-mono">
              _
            </span>
          </h1>
          <p className="max-w-xl text-lg text-zinc-700 dark:text-zinc-300">
            We find the subscriptions, fees, idle cash and interest quietly costing you, and help
            you fix them.
          </p>
          <div className="flex flex-wrap items-center gap-6">
            <GetStartedButton />
            <Link
              href="/login"
              className="font-medium underline underline-offset-2 hover:no-underline"
            >
              Sign in
            </Link>
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-400" aria-hidden="true">
            Scroll ↓
          </p>
        </Beat>

        {MOMENTS.map((moment) => (
          <Beat key={moment.label}>
            <p className={EYEBROW}>
              <span aria-hidden="true">[ </span>an example of what Jane does
              <span aria-hidden="true"> ]</span>
            </p>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{moment.label}</h2>
            <p className="text-lg text-zinc-700 dark:text-zinc-300">
              <span aria-hidden="true">&gt; </span>
              {moment.detail}
            </p>
            <p className="flex items-baseline gap-2 text-lg">
              <span className="text-zinc-600 dark:text-zinc-400">worth</span>
              <span
                aria-hidden="true"
                className="min-w-4 flex-1 overflow-hidden whitespace-nowrap text-zinc-500"
              >
                ................................................
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{moment.amount}</span>
            </p>
          </Beat>
        ))}

        {POINTS.map((point) => (
          <Beat key={point.title}>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{point.title}</h2>
            <p className="text-lg text-zinc-700 dark:text-zinc-300">{point.body}</p>
          </Beat>
        ))}

        <Beat last>
          <h2 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            See it whole
          </h2>
          <p className="text-lg text-zinc-700 dark:text-zinc-300">
            Try Jane with a sample person&apos;s money, or link your own.
          </p>
          {trialEnabled() && <TryButton />}
          <div className="flex flex-wrap items-center gap-6">
            <GetStartedButton />
            <Link
              href="/login"
              className="font-medium underline underline-offset-2 hover:no-underline"
            >
              Sign in
            </Link>
          </div>
        </Beat>
      </PillarStory>
    </main>
  );
}
