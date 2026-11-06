// Card offers shaped like Engine's credit-card marketplace (connectors roadmap round 15), read
// tolerantly, and shown the way Regulation Z wants a card's terms shown (12 CFR 1026.16, 1026.60).
// Mock only: no partner, no pay (California's Credit Services Act may bar issuer-paid card
// referrals outright), and named offers stay in demo advice mode. Not legal advice; counsel to
// confirm.

export type CardOffer = {
  id: string;
  cardName: string;
  issuer: string;
  ratesUrl: string;
  purchaseAprMinBps: number | null;
  purchaseAprMaxBps: number | null;
  variable: boolean;
  introPurchaseAprBps: number | null;
  introPurchaseMonths: number | null;
  introTransferAprBps: number | null;
  introTransferMonths: number | null;
  transferFeeBps: number | null;
  transferFeeMinCents: number | null;
  annualFeeCents: number | null;
  preApproved: boolean;
  creditRatingDisclaimer: string | null;
};

export class OfferError extends Error {
  constructor(field: string) {
    super(`Card offer refused: ${field}`);
    this.name = "OfferError";
  }
}

// "21.24", 21.24, "21.24%" -> 2124 basis points. Anything else is unknown.
function bps(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/[%\s]/g, ""));
  if (value === null || value === undefined || value === "" || !Number.isFinite(n)) return null;
  if (n < 0 || n > 100) return null;
  return Math.round(n * 100);
}

function cents(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/[$,\s]/g, ""));
  if (value === null || value === undefined || value === "" || !Number.isFinite(n) || n < 0) {
    return null;
  }
  return Math.round(n * 100);
}

// An intro term in months, from a number and a unit ("months", "billing cycles", "years").
function months(term: unknown, unit: unknown): number | null {
  const n = typeof term === "number" ? term : Number(term);
  if (!Number.isInteger(n) || n <= 0) return null;
  const u = String(unit ?? "months").toLowerCase();
  if (u.startsWith("year")) return n * 12;
  if (u.startsWith("month") || u.includes("cycle")) return n;
  return null;
}

// The transfer fee's minimum is only in its disclaimer: "3% or $5, whichever is greater".
export function minimumFromDisclaimer(text: unknown): number | null {
  const match = /\$\s?(\d+(?:\.\d{2})?)/.exec(String(text ?? ""));
  return match ? Math.round(Number(match[1]) * 100) : null;
}

// One Engine-shaped offer, read tolerantly. A missing name or a rates page that isn't https is
// refused: an offer can't be shown without its Rates & Fees link.
export function parseCardOffer(raw: unknown): CardOffer {
  const offer = (raw ?? {}) as Record<string, unknown>;
  const d = (offer.details ?? {}) as Record<string, unknown>;
  const partner = (offer.partner ?? {}) as Record<string, unknown>;
  const cardName = typeof d.cardName === "string" ? d.cardName.trim() : "";
  if (!cardName) throw new OfferError("no card name");
  const ratesUrl = typeof d.ratesUrl === "string" ? d.ratesUrl : "";
  if (!/^https:\/\//.test(ratesUrl)) throw new OfferError("no https Rates & Fees link");
  const disclaimer =
    d.recommendedCreditRatingsDisclaimer ?? d.recommendedCreditRatingDisclaimer ?? null;
  return {
    id: typeof offer.uuid === "string" ? offer.uuid : cardName,
    cardName,
    issuer: typeof partner.name === "string" ? partner.name : "",
    ratesUrl,
    purchaseAprMinBps: bps(d.minPurchaseApr),
    purchaseAprMaxBps: bps(d.maxPurchaseApr),
    variable: String(d.aprType ?? "").toLowerCase() === "variable",
    introPurchaseAprBps: bps(d.minPurchaseIntroApr),
    introPurchaseMonths: months(d.purchaseIntroAprTerm, d.purchaseIntroAprTermUnit),
    introTransferAprBps: bps(d.minBalanceTransferIntroApr),
    introTransferMonths: months(d.balanceTransferIntroAprTerm, d.balanceTransferIntroAprTermUnit),
    // A bare percent: 3 means 3%.
    transferFeeBps: bps(d.balanceTransferFee),
    transferFeeMinCents: minimumFromDisclaimer(d.balanceTransferFeeDisclaimer),
    annualFeeCents: cents(d.maxAnnualFee ?? d.minAnnualFee),
    // Never "pre-approved" unless the partner says so (FTC v. Credit Karma).
    preApproved: d.preApproved === true,
    creditRatingDisclaimer: typeof disclaimer === "string" ? disclaimer : null,
  };
}

const pct = (b: number) => `${(b / 100).toFixed(2)}%`;
const dollars = (c: number) =>
  (c / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: c % 100 === 0 ? 0 : 2,
  });

export type OfferBlock = { lines: string[]; ratesLink: { label: string; url: string } };

// The offer as one block of same-size lines (never a tooltip or footnote): every intro rate with
// "intro" in its phrase, its end, the APR after and the transfer fee; the regular APR and whether
// it varies; the annual fee; and the Rates & Fees link.
export function offerBlock(offer: CardOffer): OfferBlock {
  const lines: string[] = [offer.cardName];
  const regular =
    offer.purchaseAprMinBps === null
      ? null
      : offer.purchaseAprMaxBps !== null && offer.purchaseAprMaxBps !== offer.purchaseAprMinBps
        ? `${pct(offer.purchaseAprMinBps)} to ${pct(offer.purchaseAprMaxBps)}`
        : pct(offer.purchaseAprMinBps);
  const after = regular
    ? `then ${regular}${offer.variable ? " variable" : ""} APR`
    : "then the regular APR (see Rates & Fees)";
  if (offer.introPurchaseAprBps !== null && offer.introPurchaseMonths !== null) {
    lines.push(
      `${pct(offer.introPurchaseAprBps)} intro APR on purchases for ${offer.introPurchaseMonths} months, ${after}`,
    );
  }
  if (offer.introTransferAprBps !== null && offer.introTransferMonths !== null) {
    const fee =
      offer.transferFeeBps === null
        ? "transfer fee: see Rates & Fees"
        : `transfer fee ${pct(offer.transferFeeBps)}${offer.transferFeeMinCents !== null ? ` (at least ${dollars(offer.transferFeeMinCents)})` : ""}`;
    lines.push(
      `${pct(offer.introTransferAprBps)} intro APR on balance transfers for ${offer.introTransferMonths} months, ${after}; ${fee}`,
    );
  }
  if (regular) lines.push(`Regular APR: ${regular}${offer.variable ? ", variable" : ""}`);
  lines.push(
    `Annual fee: ${offer.annualFeeCents === null ? "see Rates & Fees" : offer.annualFeeCents === 0 ? "$0" : dollars(offer.annualFeeCents)}`,
  );
  if (offer.preApproved) lines.push("Pre-approved, as the issuer says");
  if (offer.creditRatingDisclaimer) lines.push(offer.creditRatingDisclaimer);
  return { lines, ratesLink: { label: "Rates & Fees", url: offer.ratesUrl } };
}

// What's wrong with a block under Reg Z's display rules (round 15, section 9): empty when fine.
export function regZProblems(block: OfferBlock, offer: Pick<CardOffer, "preApproved">): string[] {
  const problems: string[] = [];
  const text = block.lines.join("\n");
  const anyRate = /\d+(?:\.\d+)?%\s*(?:intro\s+)?APR/i.test(text);
  for (const line of block.lines) {
    // Every intro rate says "intro" in its own phrase, with its end, the rate after and, for a
    // transfer, the fee, all in that same line.
    if (/\b0?\.?\d+(?:\.\d+)?%[^.;]*\b(?:on purchases|on balance transfers)\b/i.test(line)) {
      if (!/\bintro\b/i.test(line)) problems.push("an intro rate without 'intro'");
      if (!/\bfor \d+ months\b/i.test(line)) problems.push("an intro rate without its end");
      if (!/\bthen\b/i.test(line)) problems.push("an intro rate without the APR after");
      if (/balance transfers/i.test(line) && !/transfer fee/i.test(line)) {
        problems.push("a transfer intro rate without its fee");
      }
    }
    if (/\bfixed\b/i.test(line) && !/\bfor \d+ (?:months|years)\b/i.test(line)) {
      problems.push("'fixed' without a period");
    }
  }
  if (anyRate && !/^Annual fee:/im.test(text)) problems.push("a rate without the annual fee");
  if (anyRate && !/variable|Regular APR/i.test(text))
    problems.push("a rate without the regular APR");
  if (block.ratesLink.label !== "Rates & Fees" || !/^https:\/\//.test(block.ratesLink.url)) {
    problems.push("no Rates & Fees link");
  }
  if (/pre-?approved/i.test(text) && !offer.preApproved) problems.push("'pre-approved' unearned");
  return problems;
}

// Who never sees a new-credit suggestion (round 15, 7.4). An age band, never a date of birth.
export type CardSuggestionFacts = {
  overdue: boolean;
  lateFeeLast12Months: boolean;
  newCardLast6Months: boolean;
  ageBand: "under_21" | "21_plus" | null;
  independentIncome: boolean | null;
  hardship: boolean;
};

export type Excluded =
  "overdue" | "late_fee" | "new_card" | "under_21_no_income" | "age_unknown" | "hardship";

export function cardSuggestionExcluded(facts: CardSuggestionFacts): Excluded | null {
  if (facts.overdue) return "overdue";
  if (facts.lateFeeLast12Months) return "late_fee";
  if (facts.newCardLast6Months) return "new_card";
  if (facts.hardship) return "hardship";
  // 12 CFR 1026.51(b): under 21 needs independent income. Not asked yet: not shown yet.
  if (facts.ageBand === null) return "age_unknown";
  if (facts.ageBand === "under_21" && facts.independentIncome !== true) return "under_21_no_income";
  return null;
}
