import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { loadActivityTimeline } from "@/lib/activity/admin";
import { validTimezone } from "@/lib/digest/week";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "../../admin-nav";
import { LoadingBar } from "@/components/loading-bar";

// One beta user's visits, newest first, in their own time zone: "10:42 opened Subscriptions,
// clicked 'Cancel', chose 'Do it myself'". Never what they typed. The view is audit-logged.

async function Timeline({ params }: { params: PageProps<"/admin/activity/[userId]">["params"] }) {
  const admin = await requireAdmin();
  const { userId } = await params;
  const timeline = await loadActivityTimeline(admin, userId);
  if (!timeline) notFound();
  const { person, visits } = timeline;
  const timeZone = validTimezone(person.timezone);
  const day = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  });
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });

  return (
    <>
      <AdminNav email={admin.email} />
      <p className="text-sm">
        <Link href="/admin/activity" className="font-medium hover:underline">
          ← Activity
        </Link>
      </p>
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight break-all">{person.email}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Signed up {day.format(person.createdAt)} · {visits.length}{" "}
          {visits.length === 1 ? "visit" : "visits"} · times in {timeZone}
        </p>
      </div>
      {visits.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">Nothing recorded yet.</p>
      ) : (
        <ol className="flex flex-col gap-6" data-visits="">
          {visits.map((visit) => (
            <li key={visit.start.toISOString()} className="flex flex-col gap-2">
              <h2 className="text-base font-semibold">
                {day.format(visit.start)}, {time.format(visit.start)} to {time.format(visit.end)}
              </h2>
              <ul className="flex flex-col gap-1 border-l border-zinc-200 pl-4 text-sm dark:border-zinc-800">
                {visit.lines.map((line, i) => (
                  <li key={i} className={line.warn ? "font-semibold" : ""}>
                    <span className="mr-2 text-zinc-500 tabular-nums">{time.format(line.at)}</span>
                    {line.warn && "⚠ "}
                    {line.text}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

export default function ActivityTimelinePage({ params }: PageProps<"/admin/activity/[userId]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense fallback={<LoadingBar />}>
        <Timeline params={params} />
      </Suspense>
    </main>
  );
}
