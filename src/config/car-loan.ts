// The car loan you already have (spec step 245): dealer add-ons financed into the loan, what
// cancelling each would refund, and whether the loan itself could be cheaper. Every rule
// names where it comes from. Refunds are estimates: the contract has the final say.

export type AddonKind = "gap" | "warranty" | "service";
export const ADDON_KINDS: readonly AddonKind[] = ["gap", "warranty", "service"];

export const ADDON_RULES: Readonly<
  Record<
    AddonKind,
    {
      label: string;
      // Found in a payment's description.
      match: RegExp;
      // A term to start from when the person hasn't said: the loan's, or the contract's.
      defaultTermMonths: number;
      // What the provider typically keeps for cancelling: a flat amount, or a share of the
      // pro-rata refund (the larger of the two when both are set).
      feeCents: number;
      feeShare: number;
      note: string;
    }
  >
> = {
  gap: {
    label: "GAP cover",
    match: /\bgap\b|guaranteed asset protection/i,
    defaultTermMonths: 72,
    feeCents: 5_000,
    feeShare: 0,
    note: "GAP pays the difference between what the car is worth and what you owe if it's totaled. Once the loan is paid off or refinanced it has nothing left to cover, and the unused part is usually refundable.",
  },
  warranty: {
    label: "Extended warranty",
    match: /extended (?:warranty|service)|vehicle (?:warranty|protection)|\bwarranty\b/i,
    defaultTermMonths: 60,
    feeCents: 0,
    feeShare: 0.1,
    note: "Most contracts refund the unused months, less a cancellation fee. Some also count the miles driven, which can lower it.",
  },
  service: {
    label: "Service contract",
    match: /service contract|maintenance plan|prepaid maintenance/i,
    defaultTermMonths: 36,
    feeCents: 5_000,
    feeShare: 0,
    note: "A prepaid service contract usually refunds the unused months, less a flat fee, and nothing for services already used.",
  },
};
export const ADDON_SOURCES = [
  {
    label: "CFPB: dealer add-ons and your auto loan",
    url: "https://www.consumerfinance.gov/consumer-tools/auto-loans/",
  },
  {
    label: "FTC: shopping for vehicle service contracts and GAP",
    url: "https://consumer.ftc.gov/articles/auto-add-ons-and-extras",
  },
] as const;
// A payment this size or bigger can be an add-on.
export const ADDON_MIN_CENTS = 20_000;
export const ADDON_LOOKBACK_DAYS = 365 * 3;
// A refund smaller than this isn't worth a message.
export const ADDON_MIN_REFUND_CENTS = 5_000;

// "Rates fell" when the best offer's rate is this far below the last check's; "score rose"
// when the credit band improved. Either is worth a look at the loan.
export const AUTO_RATE_FALL_BPS = 50;
