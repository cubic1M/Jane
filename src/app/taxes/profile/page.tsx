import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { US_STATES } from "@/config/referrals";
import { INCOME_KIND_ORDER, TAX_YEAR } from "@/config/tax";
import { requireUser } from "@/lib/session";
import { loadTaxProfile } from "@/lib/tax-profile";
import { stateName } from "@/planning/tax-profile";
import { scopedDb } from "@/lib/db-scoped";
import { hasDemoBank } from "@/lib/plaid/demo";
import { TaxProfileForm } from "./form";
import { PayStubForm } from "./pay-stub-form";

// The tax profile (spec step 118): every answer, and what Jane found, can be changed here.

async function ProfileContent() {
  const user = await requireUser();
  await connection();
  const db = await scopedDb();
  const [view, demo, pay] = await Promise.all([
    loadTaxProfile(user.id),
    hasDemoBank(user.id),
    db.taxProfiles.findFirst({
      select: {
        payAsOf: true,
        payGrossYtdCents: true,
        payFederalYtdCents: true,
        payStateYtdCents: true,
        payRetirementYtdCents: true,
        payPretaxYtdCents: true,
      },
    }),
  ]);
  const dollars = (cents: number | null | undefined) =>
    cents === null || cents === undefined ? "" : (cents / 100).toFixed(2);
  const seen = new Map(
    view.incomeKinds.found.map((f) => [f.kind, f.from.join(" and ") || "your accounts"]),
  );

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Your tax profile</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          What Jane needs to know for your {TAX_YEAR} taxes. She works out what she can from your
          accounts and marks it; everything else is your answer, and you can change any of it.
        </p>
      </div>
      <TaxProfileForm
        values={{
          incomeKinds: INCOME_KIND_ORDER.map((kind) => ({
            kind,
            checked: view.incomeKinds.value.includes(kind),
            seen: seen.get(kind) ?? null,
          })),
          filingStatus: view.filingStatus.value ?? "",
          childrenUnder17:
            view.dependants.childrenUnder17 === null ? "" : String(view.dependants.childrenUnder17),
          otherDependants:
            view.dependants.otherDependants === null ? "" : String(view.dependants.otherDependants),
          state: view.state.value ?? "",
          stateNote:
            view.state.status === "found"
              ? `Found by Jane: ${stateName(view.state.value)}, going by ${view.state.from}. Save to confirm it.`
              : null,
          states: [...US_STATES],
        }}
      />
      <PayStubForm
        demo={demo}
        values={{
          asOf: pay?.payAsOf ? pay.payAsOf.toISOString().slice(0, 10) : "",
          gross: dollars(pay?.payGrossYtdCents),
          federal: dollars(pay?.payFederalYtdCents),
          state: dollars(pay?.payStateYtdCents),
          retirement: dollars(pay?.payRetirementYtdCents),
          pretax: dollars(pay?.payPretaxYtdCents),
        }}
      />
      <Link href="/taxes" className="font-medium text-emerald-700 hover:underline">
        Back to taxes
      </Link>
    </>
  );
}

export default function TaxProfilePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <ProfileContent />
      </Suspense>
    </main>
  );
}
