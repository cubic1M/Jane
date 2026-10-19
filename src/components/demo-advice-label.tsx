import { DEMO_ADVICE_LABEL } from "@/config/advice";

// The label on every piece of demo advice (spec step 98), in the chat and on pages, so
// sample-data recommendations are never mistaken for real financial advice.
export function DemoAdviceLabel({ className = "" }: { className?: string }) {
  return (
    <p
      role="note"
      data-demo-advice=""
      className={`text-xs font-semibold text-amber-900 dark:text-amber-200 ${className}`}
    >
      {DEMO_ADVICE_LABEL}
    </p>
  );
}
