import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import {
  CRYPTO_CONNECTION_KINDS,
  CRYPTO_FEE_SOURCE,
  CRYPTO_SHARE_FLAG,
  CRYPTO_SHARE_SOURCE,
} from "@/config/crypto";
import { loadCrypto } from "@/lib/crypto/crypto";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { linkCrypto, refreshCrypto } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { LoadingBar } from "@/components/loading-bar";

// Crypto (spec step 161): seen and sized, never traded. Each balance says where it came
// from and when; in demo advice mode, flags for too big a share and costly fees.

const LINK = "font-medium text-emerald-700 hover:underline";
const BUTTON = "h-11 rounded-lg bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800";
const SECONDARY =
  "h-11 rounded-lg border border-zinc-300 px-5 font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900";
const DONE: Record<string, string> = {
  linked: "Connected, read-only.",
  refreshed: "Balances read again.",
};
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
const when = (d: Date) =>
  d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });

async function CryptoContent({
  searchParams,
}: {
  searchParams: PageProps<"/investments/crypto">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const { done } = await searchParams;
  const view = await loadCrypto(user.id);
  const has = (name: string) => view.connections.some((c) => c.name === name);

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <Link href="/investments" className={`text-sm ${LINK}`}>
          ← Investments
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Crypto</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Jane reads what your exchanges and wallets hold and counts it in your net worth. Jane
          never buys, sells or moves crypto, and never asks for keys.
        </p>
      </div>
      {typeof done === "string" && Object.hasOwn(DONE, done) && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
        >
          {DONE[done]}
        </p>
      )}

      {view.connections.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          No crypto connected.{" "}
          {view.demo
            ? "Try a demo exchange or wallet below."
            : "Connecting a real exchange or wallet needs a crypto data partner, coming later."}
        </p>
      ) : (
        <section className="flex flex-col gap-2">
          <p className="text-2xl font-semibold">{formatCents(view.size.totalCents)}</p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {pct(view.size.share)} of everything you&apos;ve invested
            {view.size.gainCents !== null
              ? `; ${view.size.gainCents >= 0 ? "up" : "down"} ${formatCents(Math.abs(view.size.gainCents))} on what you paid`
              : ""}
            .
          </p>
        </section>
      )}

      {view.connections.map((c) => (
        <section
          key={c.id}
          className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <h2 className="text-xl font-semibold">
            {c.name}: {formatCents(c.totalCents)}
          </h2>
          <p className="text-xs text-zinc-500">
            {CRYPTO_CONNECTION_KINDS[c.kind]}
            {c.address ? ` ${c.address.slice(0, 6)}…${c.address.slice(-4)}` : ""}. From {c.source},{" "}
            {c.asOf ? `as of ${when(c.asOf)}` : "not read yet"}
            {c.stale ? " (out of date)" : ""}.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500">
                <th className="font-normal">Asset</th>
                <th className="text-right font-normal">Amount</th>
                <th className="text-right font-normal">Price</th>
                <th className="text-right font-normal">Value</th>
              </tr>
            </thead>
            <tbody>
              {view.holdings
                .filter((h) => h.connectionId === c.id)
                .map((h) => (
                  <tr key={h.id}>
                    <td>
                      {h.name} ({h.asset})
                    </td>
                    <td className="text-right">
                      {h.quantity.toLocaleString("en-US", { maximumFractionDigits: 6 })}
                    </td>
                    <td className="text-right">{formatCents(h.priceCents)}</td>
                    <td className="text-right">{formatCents(h.valueCents)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ))}

      {view.advice && (view.size.overShare || view.fees?.flag) && (
        <section className="flex flex-col gap-2 rounded-xl border border-amber-300 p-4 dark:border-amber-800">
          <h2 className="text-xl font-semibold">Worth a look</h2>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
            {view.size.overShare && (
              <li>
                Crypto is {pct(view.size.share)} of what you&apos;ve invested. It can fall by half
                or more in a year; a common rule of thumb keeps a speculative holding to about{" "}
                {pct(CRYPTO_SHARE_FLAG)} ({CRYPTO_SHARE_SOURCE}).
              </li>
            )}
            {view.fees?.flag && view.fees.bps !== null && (
              <li>
                Your exchange&apos;s fees were {formatCents(view.fees.feesCents)} on{" "}
                {formatCents(view.fees.tradedCents)} of trades this past year ({view.fees.bps / 100}
                %). The same trades at a low-cost exchange would cost about{" "}
                {formatCents(view.fees.lowCostCents.lowCents)} to{" "}
                {formatCents(view.fees.lowCostCents.highCents)} ({CRYPTO_FEE_SOURCE}).
              </li>
            )}
          </ul>
          <p className="text-xs text-zinc-500">
            Any change is yours to make at your exchange: Jane doesn&apos;t trade crypto.
          </p>
          <DemoAdviceLabel />
        </section>
      )}

      <div className="flex flex-wrap gap-3">
        {view.demo && !has("Demo Exchange") && (
          <form action={linkCrypto}>
            <input type="hidden" name="kind" value="exchange" />
            <SubmitButton className={BUTTON}>Connect a demo exchange</SubmitButton>
          </form>
        )}
        {view.demo && !has("Demo Wallet") && (
          <form action={linkCrypto}>
            <input type="hidden" name="kind" value="wallet" />
            <SubmitButton className={SECONDARY}>Add a demo wallet</SubmitButton>
          </form>
        )}
        {view.connections.length > 0 && (
          <form action={refreshCrypto}>
            <SubmitButton className={SECONDARY}>Read balances again</SubmitButton>
          </form>
        )}
      </div>
    </>
  );
}

export default function CryptoPage(props: PageProps<"/investments/crypto">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <CryptoContent searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
