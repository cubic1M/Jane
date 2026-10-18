import { OPTION_KINDS, PLAN_CATEGORIES, type OptionKind } from "@/config/compare";
import { normalizeAlias } from "@/data-sources/merchant-directory";
import type { Prisma } from "@/generated/prisma/client";

// Checking an option the team adds on /admin/options (spec step 76). Prices come from the
// provider's own page, with the day they were checked; anything missing or odd is refused
// with a message the team can act on. Pure.

export type OptionInput = Record<
  | "kind"
  | "category"
  | "merchant"
  | "provider"
  | "name"
  | "monthly"
  | "apy"
  | "contractMonths"
  | "fee"
  | "minimumBalance"
  | "includes"
  | "givesUp"
  | "signUpUrl"
  | "sourceUrl"
  | "checkedAt",
  string
> & { reviewed: boolean };

export type OptionCheck =
  { ok: true; data: Omit<Prisma.SwitchOptionCreateInput, "id"> } | { ok: false; message: string };

const fail = (message: string): OptionCheck => ({ ok: false, message });

function dollars(text: string, max: number): number | null {
  const value = Number(text.replace(/[$,\s]/g, ""));
  return text.trim() === "" || !Number.isFinite(value) || value < 0 || value > max
    ? null
    : Math.round(value * 100);
}

function httpsUrl(text: string): string | null {
  try {
    const url = new URL(text.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function validateOption(input: OptionInput, today: string): OptionCheck {
  const kind = input.kind as OptionKind;
  if (!OPTION_KINDS.includes(kind)) return fail("Pick a plan, a tier or a savings account.");
  const provider = input.provider.trim();
  const name = input.name.trim();
  if (!provider || provider.length > 100) return fail("Add the provider's name.");
  if (!name || name.length > 100) return fail("Add the option's name.");

  let category: string | null = null;
  let merchantKey: string | null = null;
  if (kind === "plan") {
    if (!(PLAN_CATEGORIES as readonly string[]).includes(input.category)) {
      return fail("Pick which bill a plan replaces.");
    }
    category = input.category;
    // The provider, so Jane never suggests the plan someone already has.
    merchantKey = normalizeAlias(provider);
  } else if (kind === "tier") {
    merchantKey = normalizeAlias(input.merchant);
    if (!merchantKey) return fail("Name the service this is a cheaper tier of.");
  } else {
    category = "savings";
  }

  let monthlyCents: number | null = null;
  let apyBps: number | null = null;
  if (kind === "savings") {
    const apy = Number(input.apy.replace(/[%\s]/g, ""));
    if (!input.apy.trim() || !Number.isFinite(apy) || apy <= 0 || apy > 20) {
      return fail("Add the yearly rate (APY), between 0% and 20%.");
    }
    apyBps = Math.round(apy * 100);
  } else {
    monthlyCents = dollars(input.monthly, 10_000);
    if (!monthlyCents) return fail("Add the price a month, in dollars.");
  }

  const contractMonths = input.contractMonths.trim() === "" ? 0 : Number(input.contractMonths);
  if (!Number.isInteger(contractMonths) || contractMonths < 0 || contractMonths > 60) {
    return fail("The contract is a whole number of months, 0 to 60.");
  }
  const oneTimeFeeCents = input.fee.trim() === "" ? 0 : dollars(input.fee, 1_000);
  if (oneTimeFeeCents === null) return fail("The one-time fee is $0 to $1,000.");
  const minimumBalanceCents =
    input.minimumBalance.trim() === "" ? 0 : dollars(input.minimumBalance, 1_000_000);
  if (minimumBalanceCents === null) return fail("The minimum balance is $0 to $1,000,000.");

  const sourceUrl = httpsUrl(input.sourceUrl);
  if (!sourceUrl) return fail("Add the https page the price comes from.");
  const signUpUrl = input.signUpUrl.trim() === "" ? null : httpsUrl(input.signUpUrl);
  if (input.signUpUrl.trim() !== "" && !signUpUrl) return fail("The sign-up link must be https.");
  const checkedAt = input.checkedAt.trim() || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedAt) || checkedAt > today) {
    return fail("The day the price was checked can't be in the future.");
  }
  const short = (text: string) => text.trim().slice(0, 200) || null;

  return {
    ok: true,
    data: {
      kind,
      category,
      merchantKey,
      provider,
      name,
      monthlyCents,
      apyBps,
      contractMonths,
      oneTimeFeeCents,
      minimumBalanceCents,
      includes: short(input.includes),
      givesUp: short(input.givesUp),
      signUpUrl,
      sourceUrl,
      checkedAt: new Date(`${checkedAt}T00:00:00Z`),
      reviewedAt: input.reviewed ? new Date() : null,
    },
  };
}
