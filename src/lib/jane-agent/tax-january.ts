import { TAX_TAGS } from "@/config/tax";
import type { TaxEstimateView } from "@/lib/tax-estimate";
import type { TaxPack } from "@/planning/tax-pack";
import { federalLine, roundDollars } from "@/planning/tax-estimate-copy";
import { listOf } from "@/planning/tax-profile";
import type { MessageAction, MessageRefs } from "./types";

// The one message in January (spec step 127): last year's taxes, ready. The estimate, what
// the tax-time pack holds, and which forms are in.

export function januaryMessage(
  pack: TaxPack,
  estimate: TaxEstimateView | null,
): { body: string; actions: MessageAction[]; refs: MessageRefs } {
  const groups: [string, number][] = [
    [TAX_TAGS.donation.plural, pack.charity.totalCents],
    ...(Object.keys(pack.preparer) as (keyof TaxPack["preparer"])[]).map((g): [string, number] => [
      TAX_TAGS[g].plural,
      pack.preparer[g].totalCents,
    ]),
  ];
  const tagged = groups.filter(([, c]) => c > 0).map(([label, c]) => `${label} ${roundDollars(c)}`);
  const expected = pack.forms.filter((f) => !f.mayNotSend);
  const received = expected.filter((f) => f.received).length;
  const estimateLine =
    estimate && estimate.year === pack.year
      ? ` My estimate: ${federalLine(estimate.estimate, estimate.withholdingKnown).replace(/^Federal: /, "federal, ")}`
      : "";
  const forms =
    expected.length > 0
      ? ` ${received} of ${expected.length} tax forms are in; the rest usually arrive by mid-February.`
      : "";
  return {
    body: `Your ${pack.year} taxes are ready to go.${estimateLine} Your tax-time pack has ${tagged.length > 0 ? listOf(tagged) : "your income and forms"}.${forms}`,
    actions: [
      {
        id: "open",
        label: "Open the tax-time pack",
        kind: "link",
        href: `/tax-pack?year=${pack.year}`,
      },
      { id: "open", label: "See your taxes", kind: "link", href: "/taxes" },
    ],
    refs: { taxYear: pack.year },
  };
}
