import { Suspense } from "react";
import { COUNSEL_INSURANCE_REFERRALS } from "@/config/referrals";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "../admin-nav";
import { turnOffPartner } from "./actions";
import { PartnerForm, type PartnerFormValues } from "./partner-form";
import { SubmitButton } from "@/components/submit-button";

const ACTION_TYPES = [
  "move_idle_cash",
  "insurance_reshop",
  "card_interest",
  "negotiate_bill",
  "cancel_subscription",
  "fight_price_increase",
  "recover_bank_fees",
  "review_cash_flow",
  "request_refund",
] as const;

const EMPTY: PartnerFormValues = {
  id: "",
  key: "",
  name: "",
  actionType: "move_idle_cash",
  disclosure: "",
  referralUrl: "",
  allowedStates: "",
  revenuePerConversion: "",
  active: false,
};

async function Partners() {
  const admin = await requireAdmin();
  const partners = await db.referralPartner.findMany({
    orderBy: { key: "asc" },
    include: { conversions: { select: { amountCents: true } } },
  });

  return (
    <>
      <AdminNav email={admin.email} />
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">Referral partners</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          A partner is offered on cards for its action, only to people in its states, with its
          disclosure shown word for word. Turning one off takes effect on the next page load.
        </p>
        <p className="text-sm">
          Insurance referrals:{" "}
          {COUNSEL_INSURANCE_REFERRALS.approved
            ? `allowed (counsel, ${COUNSEL_INSURANCE_REFERRALS.recordedOn})`
            : "off until counsel's answer is recorded in src/config/referrals.ts"}
          .
        </p>
      </div>

      <details className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <summary className="cursor-pointer font-semibold">Add a partner</summary>
        <div className="mt-4">
          <PartnerForm values={EMPTY} actionTypes={ACTION_TYPES} />
        </div>
      </details>

      {partners.length === 0 ? (
        <p className="text-sm text-zinc-500">No partners yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {partners.map((p) => (
            <li key={p.id} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">
                  {p.name}{" "}
                  <span className="text-xs font-normal text-zinc-500">
                    {p.actionType.replaceAll("_", " ")} ·{" "}
                    {p.allowedStates.join(", ") || "no states"} · {p.conversions.length}{" "}
                    conversions,{" "}
                    {formatCents(p.conversions.reduce((sum, c) => sum + c.amountCents, 0))}
                  </span>
                </span>
                {p.active ? (
                  <form action={turnOffPartner}>
                    <input type="hidden" name="id" value={p.id} />
                    <SubmitButton className="rounded-full bg-red-700 px-4 py-1 text-xs font-semibold text-white">
                      Turn off now
                    </SubmitButton>
                  </form>
                ) : (
                  <span className="text-xs font-semibold text-zinc-500">Off</span>
                )}
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-sm">Edit</summary>
                <div className="mt-3">
                  <PartnerForm
                    actionTypes={ACTION_TYPES}
                    values={{
                      id: p.id,
                      key: p.key,
                      name: p.name,
                      actionType: p.actionType,
                      disclosure: p.disclosure,
                      referralUrl: p.referralUrl,
                      allowedStates: p.allowedStates.join(", "),
                      revenuePerConversion:
                        p.revenuePerConversionCents === null
                          ? ""
                          : String(p.revenuePerConversionCents / 100),
                      active: p.active,
                    }}
                  />
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function PartnersPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Partners />
      </Suspense>
    </main>
  );
}
