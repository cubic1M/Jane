import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { dayLabel } from "@/lib/day-label";
import { viewPlanLink } from "@/lib/plan-links";
import { GoAheadForm, TakeBackForm } from "./go-forms";
import { LoadingBar } from "@/components/loading-bar";

// The link is private to the person: never indexed.
export const metadata = { robots: { index: false, follow: false } };

// Opened from a one-tap link in the weekly email or a notification (spec step 60). The
// link's token is the credential, so no sign-in; opening the page changes nothing, the
// button does.

async function Content({ searchParams }: { searchParams: PageProps<"/plan/go">["searchParams"] }) {
  // Per request: the link's state depends on the time, and nothing here may be prerendered.
  await connection();
  const { token } = await searchParams;
  const value = typeof token === "string" ? token : "";
  const view = await viewPlanLink(value);

  if (view.state === "invalid" || view.state === "expired") {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">
          {view.state === "expired" ? "This link has expired" : "This link doesn't work"}
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Links work for a week. Your plan is always in the app.
        </p>
        <Link href="/plan" className="font-medium text-emerald-700 hover:underline">
          Open your plan
        </Link>
      </>
    );
  }
  if (view.state === "used") {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">
          {view.approved === 0
            ? "Taken back"
            : `Jane is on ${view.approved} ${view.approved === 1 ? "thing" : "things"}`}
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          From this link on {dayLabel(view.usedOn, { year: true })}.
        </p>
        {view.canTakeBack && <TakeBackForm token={value} />}
        <Link href="/actions" className="font-medium text-emerald-700 hover:underline">
          Follow along on your actions
        </Link>
      </>
    );
  }
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">This week, Jane will</h1>
      <ul className="flex list-disc flex-col gap-1 pl-5">
        {view.items.map((item) => (
          <li key={item.title} className="[overflow-wrap:anywhere]">
            {item.title}
          </li>
        ))}
      </ul>
      <GoAheadForm token={value} count={view.items.length} />
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Only requests that can&apos;t cost you anything. Calls, cancellations and moving money
        always wait for you in the app.{" "}
        <Link href="/plan" className="font-medium text-emerald-700 hover:underline">
          See the whole plan
        </Link>
      </p>
    </>
  );
}

export default function GoPage({ searchParams }: PageProps<"/plan/go">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-5 px-4 py-16">
      <Suspense fallback={<LoadingBar />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
