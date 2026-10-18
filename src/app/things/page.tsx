import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { ASSET_KINDS } from "@/config/net-worth";
import { SYNCED_KINDS, syncedKindOf } from "@/data-sources/types";
import { scopedDb } from "@/lib/db-scoped";
import { formatCents } from "@/lib/money";
import { isAssetKind, listAssets, type AssetLine } from "@/lib/owned-assets";
import { requireUser } from "@/lib/session";
import { deleteAsset } from "./actions";
import { AssetForm } from "./asset-form";

// Things you own (spec step 67): a home, a car, anything else of value, at the value the
// person gives. Counted in net worth; with the loan against it, shown as equity.

const LINK = "font-medium text-emerald-700 hover:underline";

const SAVED: Record<string, string> = {
  added: "Added. It now counts in your net worth.",
  updated: "Saved.",
  removed: "Removed. It no longer counts in your net worth.",
};

// What a prefilled form names the thing, from "Add your home's value" on /loans.
const DEFAULT_NAME: Record<string, string> = { home: "Home", vehicle: "Car" };

const dateLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

const dollars = (cents: number) => (cents / 100).toFixed(2);

function EquityLine({ asset }: { asset: AssetLine }) {
  if (!asset.loan) return null;
  if (asset.equityCents === null) {
    return (
      <p className="text-sm">
        Against {asset.loan.name}. Your bank hasn&apos;t reported its balance, so we can&apos;t show
        what you own of it.
      </p>
    );
  }
  return (
    <p className="text-sm">
      {asset.equityCents >= 0
        ? `You own about ${formatCents(asset.equityCents)} of it`
        : `You owe about ${formatCents(-asset.equityCents)} more than it's worth`}{" "}
      <span className="text-zinc-600 dark:text-zinc-400">
        ({formatCents(asset.valueCents)} minus the {formatCents(asset.loan.balanceCents ?? 0)} left
        on {asset.loan.name}).
      </span>
    </p>
  );
}

async function ThingsContent({
  searchParams,
}: {
  searchParams: PageProps<"/things">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const params = await searchParams;
  const one = (key: string) => {
    const v = params[key];
    return typeof v === "string" ? v : "";
  };
  const db = await scopedDb();
  const today = new Date().toISOString().slice(0, 10);
  const [assets, loanRows] = await Promise.all([
    listAssets(user.id),
    db.accounts.findMany({
      where: { type: "loan" },
      select: { id: true, name: true, type: true, subtype: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const loans = loanRows.map((l) => {
    const kind = syncedKindOf(l.type, l.subtype);
    return { id: l.id, name: l.name, label: kind ? SYNCED_KINDS[kind].label : "Loan" };
  });
  const saved = SAVED[one("saved")];
  const editing = one("edit");
  // Prefilled from a prompt: /things?kind=home&loan=<id>. Only their own loans.
  const kind = isAssetKind(one("kind")) ? one("kind") : "home";
  const loan = loans.some((l) => l.id === one("loan")) ? one("loan") : "";
  const total = assets.reduce((sum, a) => sum + a.valueCents, 0);

  return (
    <>
      <AppHeader email={user.email} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Things you own</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Your home, your car and anything else of value, at what you say it&apos;s worth. They
          count in your{" "}
          <Link href="/net-worth" className={LINK}>
            net worth
          </Link>
          . Jane never estimates a value.
        </p>
      </div>

      {saved && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
        >
          {saved}
        </p>
      )}

      {assets.length > 0 && (
        <>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Together worth {formatCents(total)}, by your values.
          </p>
          <ul className="flex flex-col gap-3">
            {assets.map((a) => (
              <li
                key={a.id}
                id={`asset-${a.id}`}
                className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 [overflow-wrap:anywhere] dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex min-w-0 flex-col">
                    <h2 className="font-semibold">{a.name}</h2>
                    <span className="text-sm text-zinc-500">{ASSET_KINDS[a.kind]}</span>
                  </div>
                  <span className="text-xl font-semibold">{formatCents(a.valueCents)}</span>
                </div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Your value from {dateLabel(a.valuedOn)}.
                  {a.stale && (
                    <>
                      {" "}
                      That&apos;s over a year ago.{" "}
                      <Link href={`/things?edit=${a.id}#asset-${a.id}`} className={LINK}>
                        Update it?
                      </Link>
                    </>
                  )}
                </p>
                <EquityLine asset={a} />
                <details open={editing === a.id}>
                  <summary className="cursor-pointer text-sm text-emerald-700">Edit</summary>
                  <div className="mt-3">
                    <AssetForm
                      loans={loans}
                      today={today}
                      values={{
                        assetId: a.id,
                        kind: a.kind,
                        name: a.name,
                        value: dollars(a.valueCents),
                        // A stale value is being updated: start from today.
                        valuedOn: editing === a.id && a.stale ? today : a.valuedOn,
                        loanAccountId: a.loan?.id ?? "",
                      }}
                    />
                  </div>
                </details>
                <form action={deleteAsset} className="self-end">
                  <input type="hidden" name="assetId" value={a.id} />
                  <button
                    type="submit"
                    className="text-xs text-zinc-500 hover:text-red-700 hover:underline"
                  >
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </>
      )}

      <section id="add" className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">
          {assets.length === 0 ? "Add something you own" : "Add another"}
        </h2>
        <AssetForm
          loans={loans}
          today={today}
          values={{
            assetId: "",
            kind,
            name: loan ? (DEFAULT_NAME[kind] ?? "") : "",
            value: "",
            valuedOn: today,
            loanAccountId: loan,
          }}
        />
      </section>

      <p className="rounded-xl bg-zinc-100 p-4 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
        These are your own values, not appraisals, and Jane doesn&apos;t look them up or guess them.
        What you&apos;d actually get if you sold can be different.
      </p>
    </>
  );
}

export default function ThingsPage({ searchParams }: PageProps<"/things">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <ThingsContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
