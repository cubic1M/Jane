import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { IRS_WITHHOLDING_ESTIMATOR_URL } from "@/config/tax";
import { formatCents } from "@/lib/money";
import type { WithholdingView } from "@/lib/tax-withholding";
import { balancePhrase } from "@/planning/tax-estimate-copy";
import type { W4Change } from "@/planning/withholding";
import { W4Buttons } from "./w4-buttons";

// The withholding checkup on /taxes (spec step 121). The W-4 suggestion is demo advice,
// labelled; real accounts get the comparison and the IRS's estimator.

const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";
const LINK = "font-medium text-emerald-700 hover:underline";

const where = (c: W4Change) =>
  c.step === "4b"
    ? `Step 4(b), Deductions: ${formatCents(c.amountCents)}`
    : `Step 4(c), Extra withholding: ${formatCents(c.amountCents)} a paycheck`;

export function WithholdingSection({ view }: { view: WithholdingView }) {
  const { check, estimate, advice } = view;
  const day = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  return (
    <section aria-labelledby="withholding-heading" id="withholding" className={CARD}>
      <h2 id="withholding-heading" className="text-xl font-semibold">
        Withholding
      </h2>
      {estimate.w4 && (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            You sent a new W-4 on {day(estimate.w4.changedOn)}. Your estimate counts it:{" "}
            {balancePhrase(estimate.estimate.refundCents)}.
          </p>
          <W4Buttons kind="undo" />
        </div>
      )}
      {check.status === "unknown" && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {check.why === "no_pay"
            ? "Jane can't see regular paychecks, so there's nothing to check."
            : "Jane can see your paychecks but not what's withheld. Add your pay stub figures on your tax profile."}
        </p>
      )}
      {check.status === "on_track" && !estimate.w4 && (
        <p>
          Looks about right: {balancePhrase(check.refundCents)} for {estimate.year}.
        </p>
      )}
      {(check.status === "big_refund" || check.status === "bill_coming") && !estimate.w4 && (
        <>
          <p>
            {check.status === "big_refund"
              ? `More is being withheld than your tax: ${balancePhrase(check.refundCents)} for ${estimate.year}.`
              : `Less is being withheld than your tax: ${balancePhrase(check.refundCents)} for ${estimate.year}.`}
          </p>
          {advice ? (
            <div className="flex flex-col gap-2 rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-950/40">
              <p className="font-medium">What to put on a new W-4</p>
              <ul className="list-disc pl-5">
                {check.thisYear && (
                  <li>
                    Now, for your last {check.paychecksLeft} paychecks: {where(check.thisYear)} (
                    {balancePhrase(check.thisYear.refundAfterCents)} after).
                  </li>
                )}
                <li>From January, for a full year: {where(check.fromJanuary)}.</li>
              </ul>
              {check.thisYear?.step === "4b" && (
                // Area plan walk: "$127,700" next to "$24,500" read as a mistake without this.
                <p>
                  Step 4(b) is a yearly figure your employer spreads over all {check.perYear}{" "}
                  paychecks, so handing the refund back in {check.paychecksLeft} takes a big one:
                  about {formatCents(-check.thisYear.perPaycheckCents)} less withheld from each.
                  Switch to the January figure then.
                </p>
              )}
              <p>Keep Steps 1 to 3 as they are. Only you can give it to your employer.</p>
              <W4Buttons
                kind="suggest"
                step={(check.thisYear ?? check.fromJanuary).step}
                amountCents={(check.thisYear ?? check.fromJanuary).amountCents}
                year={estimate.year}
                canKeep={check.status === "big_refund"}
              />
              <DemoAdviceLabel />
            </div>
          ) : (
            <p className="text-sm">
              The IRS&apos;s{" "}
              <a href={IRS_WITHHOLDING_ESTIMATOR_URL} className={LINK} rel="noopener noreferrer">
                Tax Withholding Estimator
              </a>{" "}
              shows what to put on a new W-4.
            </p>
          )}
        </>
      )}
    </section>
  );
}
