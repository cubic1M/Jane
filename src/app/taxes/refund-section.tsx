import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { refundMessage } from "@/lib/jane-agent/tax-refund-message";
import type { RefundView } from "@/lib/tax-refund";
import { RefundButtons } from "./refund-buttons";

// Tax refunds on /taxes (spec step 125): each refund seen, matched to the estimate, and in
// demo advice mode where it could go.

export function RefundSection({ refunds }: { refunds: RefundView[] }) {
  if (refunds.length === 0) return null;
  return (
    <section
      aria-labelledby="refund-heading"
      id="refund"
      className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <h2 id="refund-heading" className="text-xl font-semibold">
        Refunds
      </h2>
      <ul className="flex flex-col gap-3">
        {refunds.map((r) => {
          const message = refundMessage(r);
          const plan = Boolean(message.refs.advice);
          return (
            <li key={r.refund.transactionId} className="flex flex-col gap-2 text-sm">
              <p>
                {plan && r.handled
                  ? message.body.split(" Where it could go")[0] + " Its plan is set up."
                  : message.body}
              </p>
              {plan && !r.handled && <RefundButtons transactionId={r.refund.transactionId} />}
              {plan && <DemoAdviceLabel />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
