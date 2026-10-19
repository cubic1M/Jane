import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { adviceMode } from "@/lib/advice-mode";
import { loadReview } from "@/lib/investments/review";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";

// Does it fit? (spec step 131). The mix of investments against the target for the
// person's risk level, single companies that are too big a part of it, idle cash, and what
// to change and why. Recommendations only in demo advice mode; real accounts see their mix.

const LINK = "font-medium text-emerald-700 hover:underline";
const pct = (share: number) => `${Math.round(share * 100)}%`;

async function ReviewContent() {
  const user = await requireUser();
  await connection();
  const [{ investments, profile, review }, advice] = await Promise.all([
    loadReview(user.id),
    adviceMode(user.id),
  ]);

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <Link href="/investments" className={`text-sm ${LINK}`}>
          ← Investments
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Portfolio review</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Your mix of investments against the target for your risk level. It says how your mix
          compares, never what returns will be.
        </p>
      </div>

      {investments.holdingCount === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          Nothing to review yet: Jane needs to see what&apos;s in your investment accounts.
        </p>
      ) : !advice ? (
        <>
          <ul className="flex flex-col gap-1 text-sm">
            {investments.byAssetClass.map((c) => (
              <li key={c.assetClass} className="flex justify-between gap-2">
                <span>{c.label}</span>
                <span>{formatCents(c.valueCents)}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Jane doesn&apos;t give investment recommendations on real accounts yet.
          </p>
        </>
      ) : !review || !profile.complete ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          First, four quick questions about what the money is for.{" "}
          <Link href="/investments/profile" className={LINK}>
            Answer them
          </Link>
          .
        </p>
      ) : (
        <>
          <p className="text-sm">
            Your profile: <strong>{review.riskLabel}</strong>.{" "}
            <Link href="/investments/profile" className={LINK}>
              Change it
            </Link>
          </p>
          <section className="flex flex-col gap-3" aria-labelledby="mix-heading">
            <h2 id="mix-heading" className="text-xl font-semibold">
              Your mix against your target
            </h2>
            <ul className="flex flex-col gap-3 text-sm">
              {review.mix.map((m) => (
                <li key={m.assetClass} className="flex flex-col gap-1">
                  <span className="flex flex-wrap justify-between gap-2">
                    <span>
                      {m.label}
                      {m.offTarget && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                          off target
                        </span>
                      )}
                    </span>
                    <span>
                      {pct(m.share)} now · target {pct(m.targetShare)} · {formatCents(m.valueCents)}
                    </span>
                  </span>
                  <span
                    className="relative h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900"
                    aria-hidden
                  >
                    <span
                      className="absolute inset-y-0 left-0 bg-emerald-600"
                      style={{ width: `${Math.min(100, m.share * 100)}%` }}
                    />
                    <span
                      className="absolute inset-y-0 w-0.5 bg-zinc-900 dark:bg-zinc-100"
                      style={{ left: `${Math.min(99.5, m.targetShare * 100)}%` }}
                    />
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-zinc-500">The line on each bar is the target.</p>
          </section>

          <section className="flex flex-col gap-3 rounded-xl border border-amber-300 p-4 dark:border-amber-800">
            <h2 className="text-xl font-semibold">What to change</h2>
            {review.recommendations.length === 0 ? (
              <p className="text-sm">Your mix is on target. Nothing to change.</p>
            ) : (
              <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm">
                {review.recommendations.map((r) => (
                  <li key={r.kind}>
                    <strong>{r.what}</strong> {r.why}
                  </li>
                ))}
              </ol>
            )}
            {review.recommendations.some((r) => r.kind === "rebalance") && (
              <Link href="/investments/rebalance" className={`text-sm ${LINK}`}>
                See the orders to move to the recommended mix
              </Link>
            )}
            <DemoAdviceLabel />
          </section>
          {review.leftOut.length > 0 && (
            <p className="text-xs text-zinc-500">
              Left out, because your bank doesn&apos;t say what&apos;s in them:{" "}
              {review.leftOut.join(", ")}.
            </p>
          )}
        </>
      )}
    </>
  );
}

export default function ReviewPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <ReviewContent />
      </Suspense>
    </main>
  );
}
