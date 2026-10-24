import { connection } from "next/server";
import { Suspense } from "react";
import { OPTION_STALE_DAYS } from "@/config/compare";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "../admin-nav";
import { markChecked, removeOption } from "./actions";
import { OptionForm } from "./option-form";
import { SubmitButton } from "@/components/submit-button";

const KIND_LABEL: Record<string, string> = {
  plan: "Plans from other providers",
  tier: "Cheaper tiers of the same service",
  savings: "Savings accounts",
};

async function Options() {
  const admin = await requireAdmin();
  await connection();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const staleBefore = new Date(now.getTime() - OPTION_STALE_DAYS * 86_400_000);
  const options = await db.switchOption.findMany({
    orderBy: [{ kind: "asc" }, { category: "asc" }, { name: "asc" }],
  });
  const needsWork = options.filter(
    (o) => !o.demo && (!o.reviewedAt || o.checkedAt < staleBefore),
  ).length;

  return (
    <>
      <AdminNav email={admin.email} />
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">Options to compare</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          What Jane compares bills, subscriptions and idle cash against, to pick the best one for
          each person. Jane only uses options you checked on the provider&apos;s own page in the
          last {OPTION_STALE_DAYS} days. Never insurance or investments.{" "}
          {needsWork > 0 && <strong>{needsWork} need checking.</strong>}
        </p>
      </div>

      <details className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <summary className="cursor-pointer font-semibold">Add an option</summary>
        <div className="mt-4">
          <OptionForm today={today} />
        </div>
      </details>

      {(["plan", "tier", "savings"] as const).map((kind) => {
        const rows = options.filter((o) => o.kind === kind);
        return (
          <section key={kind} className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold">{KIND_LABEL[kind]}</h2>
            {rows.length === 0 ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">None yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {rows.map((o) => {
                  const stale = o.checkedAt < staleBefore;
                  return (
                    <li
                      key={o.id}
                      className="flex flex-wrap items-center justify-between gap-2 p-3"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="font-medium break-words">
                          {o.name} <span className="text-zinc-500">({o.provider})</span>
                        </span>
                        <span className="text-xs text-zinc-600 dark:text-zinc-400">
                          {o.apyBps !== null
                            ? `${(o.apyBps / 100).toFixed(2)}% APY`
                            : o.monthlyCents !== null
                              ? `${formatCents(o.monthlyCents)} a month`
                              : ""}
                          {o.category ? ` · ${o.category}` : ""}
                          {o.merchantKey && kind === "tier" ? ` · tier of ${o.merchantKey}` : ""}
                          {` · checked ${o.checkedAt.toISOString().slice(0, 10)}`}
                        </span>
                        <span className="flex flex-wrap gap-1 text-xs">
                          {o.demo && (
                            <span className="rounded bg-amber-100 px-1.5 text-amber-900 dark:bg-amber-900 dark:text-amber-50">
                              demo only
                            </span>
                          )}
                          {!o.demo && !o.reviewedAt && (
                            <span className="rounded bg-red-100 px-1.5 text-red-800 dark:bg-red-950 dark:text-red-300">
                              not checked
                            </span>
                          )}
                          {!o.demo && stale && (
                            <span className="rounded bg-red-100 px-1.5 text-red-800 dark:bg-red-950 dark:text-red-300">
                              price is old
                            </span>
                          )}
                        </span>
                      </span>
                      {!o.demo && (
                        <span className="flex gap-2">
                          <form action={markChecked}>
                            <input type="hidden" name="id" value={o.id} />
                            <SubmitButton className="text-sm font-medium text-emerald-700 hover:underline">
                              Checked today
                            </SubmitButton>
                          </form>
                          <form action={removeOption}>
                            <input type="hidden" name="id" value={o.id} />
                            <SubmitButton className="text-sm font-medium text-red-700 hover:underline">
                              Remove
                            </SubmitButton>
                          </form>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}

export default function OptionsPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Options />
      </Suspense>
    </main>
  );
}
