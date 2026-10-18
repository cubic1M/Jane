import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { TEAM_ACCESS_PAGE_LIMIT } from "@/config/team-access";
import { db } from "@/lib/db";
import { validTimezone } from "@/lib/digest/week";
import { requireUser } from "@/lib/session";
import { teamAccessFor } from "@/lib/team-access-loader";

// Who saw my data (spec step 74): every time our concierge team or Jane's agent viewed or
// acted on the person's data, newest first, by role only.

const LINK = "font-medium text-emerald-700 hover:underline";

async function TeamAccessContent() {
  const user = await requireUser();
  await connection();
  const [entries, prefs] = await Promise.all([
    teamAccessFor(user.id),
    db.user.findUniqueOrThrow({ where: { id: user.id }, select: { timezone: true } }),
  ]);
  const when = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: validTimezone(prefs.timezone),
  });

  return (
    <>
      <AppHeader email={user.email} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Who saw my data</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Every time our concierge team or Jane&apos;s agent looked at or acted on your data, and
          the request it was for. Team members are shown by role, not by name.
        </p>
      </div>

      {entries.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          Our team hasn&apos;t looked at or acted on your data.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {entries.map((entry) => (
            <li
              key={entry.key}
              className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 [overflow-wrap:anywhere] dark:border-zinc-800"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-semibold">{entry.what}</span>
                <time dateTime={entry.at.toISOString()} className="text-sm text-zinc-500">
                  {when.format(entry.at)}
                </time>
              </div>
              <span className="text-sm text-zinc-600 dark:text-zinc-400">{entry.who}</span>
              <span className="text-sm">
                For:{" "}
                {entry.actionId ? (
                  <Link href="/actions" className={LINK}>
                    {entry.why}
                  </Link>
                ) : (
                  entry.why
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="rounded-xl bg-zinc-100 p-4 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
        This page shows the latest {TEAM_ACCESS_PAGE_LIMIT}.{" "}
        <a href="/api/export" download className={LINK}>
          Download my data
        </a>{" "}
        has the full list. Our team only opens your data to carry out something you approved, and
        every look is logged.
      </p>
      <Link href="/settings" className={`self-start ${LINK}`}>
        Back to settings
      </Link>
    </>
  );
}

export default function TeamAccessPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <TeamAccessContent />
      </Suspense>
    </main>
  );
}
