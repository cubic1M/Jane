import type { ReactElement } from "react";
import { AppHeader } from "@/components/app-header";
import { BackLink } from "@/components/back-link";
import { CARD_ROOMY } from "@/components/card";
import { NoTaxParamsError } from "@/config/tax-params";
import { noParamsText } from "@/lib/tax-estimate-state";

type User = Parameters<typeof AppHeader>[0]["user"];

// The Taxes page for a year Jane has no IRS figures for (NoTaxParamsError, W-N): no estimate, no
// refund, no saving, only the sentence. `group` is set when one group of a supported year is awaited.
export function NoParamsPage({
  user,
  year,
  group,
  back = false,
}: {
  user: User;
  year: number;
  group?: string;
  // On a sub-page: a way back to /taxes.
  back?: boolean;
}) {
  return (
    <>
      <AppHeader user={user} />
      {back && <BackLink href="/taxes" label="Taxes" className="font-medium underline" />}
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Taxes: {year}</h1>
      </div>
      <section aria-label="Tax figures" className={CARD_ROOMY}>
        <p className="text-zinc-700 dark:text-zinc-300">{noParamsText(year, group)}</p>
      </section>
    </>
  );
}

// A sub-page under /taxes or /what-if that prices a tax year runs its loader here (Tax T32b). A year
// without IRS figures (or an awaited group of one) becomes the W-N page instead of the error page.
// Each page does this itself: a layout guard would make the layout dynamic and break the static
// instant-loading shell. Anything else the loader throws still throws.
export async function orNoParams<T>(
  user: User,
  load: () => Promise<T>,
  // False outside /taxes: the page has no way back to it.
  back = true,
): Promise<{ page: ReactElement; value?: undefined } | { page: null; value: T }> {
  try {
    return { page: null, value: await load() };
  } catch (error) {
    if (error instanceof NoTaxParamsError) {
      return {
        page: <NoParamsPage user={user} year={error.year} group={error.group} back={back} />,
      };
    }
    throw error;
  }
}
