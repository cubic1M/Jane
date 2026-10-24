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
import { ConfirmDependants } from "./confirm-dependants";
import { TaxProfileForm } from "./form";
import { PayStubForm } from "./pay-stub-form";
import { ResidencyForm } from "./residency-form";
import { FamilyForm } from "./family-form";
import { HomeForm } from "./home-form";
import { SideIncomeForm } from "./side-income-form";
import { FAMILY_FORM_CHILDREN } from "./answers";
import { parseChildren } from "@/lib/family-taxes";
import { loadResidency } from "@/lib/tax-states";
import { localitiesIn } from "@/planning/tax-states";
import { defaultTaxYear } from "@/planning/tax-pack";

// The tax profile (spec step 118): every answer, and what Jane found, can be changed here.

async function ProfileContent() {
  const user = await requireUser();
  await connection();
  const db = await scopedDb();
  const year = defaultTaxYear(new Date().toISOString().slice(0, 10));
  const [view, demo, pay, residency] = await Promise.all([
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
        familyChildren: true,
        spouseWagesCents: true,
        paysOverHalfHome: true,
        studentYearsBefore: true,
        studentHalfTime: true,
        pointsCents: true,
        pointsYear: true,
        pointsPurchase: true,
        pointsLoanYears: true,
        homeBoughtOn: true,
        homePriceCents: true,
        homeSoldOn: true,
        homeSaleCents: true,
        homeSaleCostsCents: true,
        homeDaysLivedIn: true,
        rentalPriceCents: true,
        rentalPlacedOn: true,
        sideIncomeKind: true,
      },
    }),
    loadResidency(user.id, year),
  ]);
  const move = residency.told?.[0] ?? residency.spotted;
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
      {view.dependants.status === "found" &&
        view.dependants.childrenUnder17 !== null &&
        view.dependants.otherDependants !== null && (
          <ConfirmDependants
            childrenUnder17={view.dependants.childrenUnder17}
            otherDependants={view.dependants.otherDependants}
            from={view.dependants.from ?? "your accounts"}
          />
        )}
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
      <ResidencyForm
        values={{
          year,
          movedOn: move?.date ?? "",
          movedFrom: move?.from ?? "",
          movedTo: move?.to ?? "",
          spottedNote:
            !residency.told && residency.spotted
              ? `Found by Jane: a move from ${stateName(residency.spotted.from)} to ${stateName(residency.spotted.to)} on ${residency.spotted.date}, going by your payments to state agencies. Save to confirm it, or tick one state all year.`
              : null,
          oneState: residency.told !== null && residency.told.length === 0,
          workState: residency.workState ?? "",
          locality: residency.locality ?? "",
          localities: localitiesIn(view.state.value),
          states: [...US_STATES],
        }}
      />
      <FamilyForm
        values={{
          year,
          children: Array.from({ length: FAMILY_FORM_CHILDREN }, (_, i) => {
            const c = parseChildren(pay?.familyChildren)[i];
            return c
              ? { age: String(c.ageAtYearEnd), ssn: c.hasSsn, months: String(c.monthsLivedWithYou) }
              : { age: "", ssn: true, months: "12" };
          }),
          spouseWages: dollars(pay?.spouseWagesCents),
          paysOverHalfHome: pay?.paysOverHalfHome ?? false,
          studentYears:
            pay?.studentYearsBefore === null || pay?.studentYearsBefore === undefined
              ? ""
              : String(pay.studentYearsBefore),
          studentHalfTime: pay?.studentHalfTime ?? true,
        }}
      />
      <HomeForm
        values={{
          year,
          points: pay?.pointsYear === year ? dollars(pay.pointsCents) : "",
          pointsPurchase: pay?.pointsPurchase ?? true,
          pointsLoanYears: pay?.pointsLoanYears ? String(pay.pointsLoanYears) : "30",
          boughtOn: pay?.homeBoughtOn ? pay.homeBoughtOn.toISOString().slice(0, 10) : "",
          price: dollars(pay?.homePriceCents),
          soldOn: pay?.homeSoldOn ? pay.homeSoldOn.toISOString().slice(0, 10) : "",
          sale: dollars(pay?.homeSaleCents),
          costs: dollars(pay?.homeSaleCostsCents),
          daysLivedIn:
            pay?.homeDaysLivedIn === null || pay?.homeDaysLivedIn === undefined
              ? ""
              : String(pay.homeDaysLivedIn),
        }}
      />
      <SideIncomeForm
        values={{
          price: dollars(pay?.rentalPriceCents),
          placedOn: pay?.rentalPlacedOn ? pay.rentalPlacedOn.toISOString().slice(0, 10) : "",
          kind: pay?.sideIncomeKind ?? "",
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
