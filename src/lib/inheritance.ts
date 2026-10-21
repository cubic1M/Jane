import { GIFT_ANNUAL_EXCLUSION_CENTS } from "@/config/family";
import { INHERITED_NAME } from "@/config/inheritance";
import { mustBeEmptyBy } from "@/planning/inheritance";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { loadProfileInput } from "@/lib/profile";
import type { TaxEstimateView } from "@/lib/tax-estimate";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import {
  estateFacts,
  giftsOverExclusion,
  spreadIra,
  type Gift,
  type Spread,
} from "@/planning/inheritance";

// Inherited money and gifts (spec step 268), from the person's own accounts and what they
// told Jane: an inherited IRA (found by the account's name) with the year it must be empty by
// and how to spread it, gifts to one person over the annual exclusion, and the estate tax
// facts. Facts for everyone; the spread is demo advice. Jane gives no legal advice.

type Options = { client?: PrismaClient; now?: Date };

// "ZELLE TO DANIEL", "VENMO PAYMENT TO EMILY ROSE": the person the money went to.
export function giftRecipient(description: string): string | null {
  const m = /\bTO\s+([A-Z][A-Z]*(?: [A-Z][A-Z]*)?)\s*$/.exec(description.toUpperCase().trim());
  return m ? m[1] : null;
}

export type InheritedIra = {
  accountId: string;
  name: string;
  balanceCents: number;
  diedYear: number | null;
  fromSpouse: boolean | null;
  // Null for a spouse (who can treat it as their own).
  emptyBy: number | null;
  yearsLeft: number | null;
  spread: Spread | null;
};

export type InheritanceView = {
  year: number;
  advice: boolean;
  inherited: InheritedIra[];
  gifts: { recipient: string; cents: number; overCents: number; splitCovers: boolean }[];
  exclusionCents: number;
  estate: string[];
};

export async function loadInheritance(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    loaded,
  }: Options & { loaded?: { estimate: TaxEstimateView; advice: boolean } } = {},
): Promise<InheritanceView> {
  const year = now.getUTCFullYear();
  const [input, estimate] = await Promise.all([
    loadProfileInput(userId, { client, now }),
    loaded ? Promise.resolve(loaded.estimate) : loadTaxEstimate(userId, { client, now }),
  ]);
  const advice = loaded?.advice ?? true;
  const diedYear =
    typeof input.told.inherited_ira_death_year === "number"
      ? input.told.inherited_ira_death_year
      : null;
  const fromSpouse =
    typeof input.told.inherited_from_spouse === "boolean" ? input.told.inherited_from_spouse : null;
  const inherited: InheritedIra[] = input.accounts
    .filter((a) => a.type === "investment" && INHERITED_NAME.test(a.name ?? ""))
    .map((a) => {
      const emptyBy =
        fromSpouse === true ? null : diedYear !== null ? mustBeEmptyBy(diedYear) : null;
      // Without the year, assume it was just inherited: the full ten years.
      const yearsLeft =
        fromSpouse === true ? null : emptyBy !== null ? Math.max(1, emptyBy - year + 1) : 10;
      return {
        accountId: a.id,
        name: a.name ?? "Inherited IRA",
        balanceCents: a.balanceCents,
        diedYear,
        fromSpouse,
        emptyBy,
        yearsLeft,
        spread:
          yearsLeft === null
            ? null
            : spreadIra({ balanceCents: a.balanceCents, yearsLeft, base: estimate.input }),
      };
    });
  const gifts: Gift[] = input.transactions
    .filter(
      (t) =>
        t.amountCents > 0 &&
        t.date.startsWith(String(year)) &&
        (t.pfc ?? "").startsWith("TRANSFER_OUT"),
    )
    .flatMap((t) => {
      const recipient = giftRecipient(t.description);
      return recipient ? [{ recipient, cents: t.amountCents }] : [];
    });
  return {
    year,
    advice,
    inherited,
    gifts: giftsOverExclusion(
      gifts,
      GIFT_ANNUAL_EXCLUSION_CENTS,
      estimate.input.filingStatus === "married_joint",
    ),
    exclusionCents: GIFT_ANNUAL_EXCLUSION_CENTS,
    estate: estateFacts(estimate.input.state),
  };
}
