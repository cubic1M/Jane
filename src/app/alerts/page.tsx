import Link from "next/link";
import { after } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { ViewTracker } from "@/components/view-tracker";
import { ALERT_LABELS } from "@/config/alerts";
import { listAlerts, markAlertsRead } from "@/lib/alerts";
import { requireUser } from "@/lib/session";

const when = (date: Date) =>
  date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

async function Alerts() {
  const user = await requireUser();
  const alerts = await listAlerts(user.id);
  // Marked read after the page is sent, so this visit still shows what was new.
  after(() => markAlertsRead(user.id));

  return (
    <>
      <AppHeader user={user} />
      <ViewTracker event="alerts_viewed" />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Alerts</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Things that just happened on your accounts and might need a look. Choose which ones we
          email you in{" "}
          <Link href="/settings#alerts" className="font-medium text-emerald-700 hover:underline">
            settings
          </Link>
          .
        </p>
      </div>

      {alerts.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          No alerts yet. We check after every update from your bank and tell you about large or
          double charges, fees, price increases, new subscriptions and low balances ahead.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {alerts.map((a) => (
            <li
              key={a.id}
              className={`flex flex-col gap-1 rounded-xl p-4 ${a.readAt ? "border border-zinc-200 dark:border-zinc-800" : "bg-amber-50 dark:bg-amber-950"}`}
            >
              <p className="flex flex-wrap justify-between gap-2 text-xs font-medium text-zinc-500">
                <span>
                  {ALERT_LABELS[a.type].label}
                  {!a.readAt && <span className="ml-2 text-amber-700">New</span>}
                </span>
                <span>{when(a.createdAt)}</span>
              </p>
              <h2 className="font-semibold">{a.title}</h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{a.body}</p>
            </li>
          ))}
        </ul>
      )}
      <Link href="/report" className="self-start font-medium text-emerald-700 hover:underline">
        Open your report
      </Link>
    </>
  );
}

export default function AlertsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Alerts />
      </Suspense>
    </main>
  );
}
