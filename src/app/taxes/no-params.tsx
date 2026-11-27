import { AppHeader } from "@/components/app-header";
import { CARD_ROOMY } from "@/components/card";
import { noParamsText } from "@/lib/tax-estimate-state";

// The Taxes page for a year Jane has no IRS figures for (NoTaxParamsError, W-N): no estimate, no
// refund, no saving, only the sentence.
export function NoParamsPage({
  user,
  year,
}: {
  user: Parameters<typeof AppHeader>[0]["user"];
  year: number;
}) {
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Taxes: {year}</h1>
      </div>
      <section aria-label="Tax figures" className={CARD_ROOMY}>
        <p className="text-zinc-700 dark:text-zinc-300">{noParamsText(year)}</p>
      </section>
    </>
  );
}
