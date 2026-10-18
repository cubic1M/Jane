import { Suspense } from "react";
import { PFC_TAXONOMY } from "@/categorize/taxonomy";
import { listMerchants } from "@/lib/merchants";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "../admin-nav";
import { MerchantForm, type MerchantFormValues } from "./merchant-form";

const CATEGORIES = Object.values(PFC_TAXONOMY).flat().sort();

const EMPTY: MerchantFormValues = {
  id: "",
  name: "",
  key: "",
  aliases: "",
  category: "",
  cancelUrl: "",
  supportUrl: "",
  supportPhone: "",
  supportEmail: "",
  typicalMonthly: "",
  reviewed: false,
};

async function Merchants() {
  const admin = await requireAdmin();
  const merchants = await listMerchants();
  const unreviewed = merchants.filter((m) => !m.reviewedAt).length;

  return (
    <>
      <AdminNav email={admin.email} />
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">Merchants</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Shared facts about companies: never anything about a person. Detection uses the names and
          categories; cancel and support links show on do-it-yourself kits and here.{" "}
          {unreviewed > 0 && <strong>{unreviewed} not reviewed yet.</strong>}
        </p>
      </div>

      <details className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <summary className="cursor-pointer font-semibold">Add a merchant</summary>
        <div className="mt-4">
          <MerchantForm values={EMPTY} categories={CATEGORIES} />
        </div>
      </details>

      <ul className="flex flex-col gap-3">
        {merchants.map((m) => (
          <li key={m.id} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <details>
              <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">{m.name}</span>
                <span className="text-xs text-zinc-500">
                  {m.key}
                  {m.aliases.length > 0 && ` · ${m.aliases.join(", ")}`} ·{" "}
                  {m.reviewedAt
                    ? `reviewed ${m.reviewedAt.toISOString().slice(0, 10)}`
                    : "not reviewed"}
                </span>
              </summary>
              <div className="mt-4">
                <MerchantForm
                  categories={CATEGORIES}
                  values={{
                    id: m.id,
                    name: m.name,
                    key: m.key,
                    aliases: m.aliases.join(", "),
                    category: m.category ?? "",
                    cancelUrl: m.cancelUrl ?? "",
                    supportUrl: m.supportUrl ?? "",
                    supportPhone: m.supportPhone ?? "",
                    supportEmail: m.supportEmail ?? "",
                    typicalMonthly:
                      m.typicalMonthlyCents === null
                        ? ""
                        : (m.typicalMonthlyCents / 100).toFixed(2),
                    reviewed: m.reviewedAt !== null,
                  }}
                />
              </div>
            </details>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function MerchantsPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Merchants />
      </Suspense>
    </main>
  );
}
