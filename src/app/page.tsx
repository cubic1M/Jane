import Link from "next/link";
import { GetStartedButton } from "@/components/get-started-button";
import { LandingViewTracker } from "@/components/landing-view-tracker";

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

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-12 px-6 py-20">
      <LandingViewTracker />

      <div className="flex flex-col gap-6">
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          See how much money you&apos;re losing
        </h1>
        <p className="max-w-xl text-lg text-zinc-600 dark:text-zinc-400">
          We find the subscriptions, fees, idle cash and interest quietly costing you, and help you
          fix them.
        </p>
        <div className="flex flex-wrap items-center gap-6">
          <GetStartedButton />
          <Link href="/login" className="font-medium text-emerald-700 hover:underline">
            Sign in
          </Link>
        </div>
      </div>

      <ul className="grid gap-6 sm:grid-cols-3">
        {POINTS.map((point) => (
          <li key={point.title} className="flex flex-col gap-1">
            <h2 className="font-semibold">{point.title}</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{point.body}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
