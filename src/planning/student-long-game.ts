import {
  FEDERAL_PROTECTIONS,
  FORGIVEN_TAX,
  LONG_GAME,
  PSLF_PAYMENTS,
} from "@/config/student-loans";
import { formatCents } from "@/lib/money";
import { addMonths } from "@/lib/dates";

// Student loans, the long game (spec step 225). Pure: Public Service Loan Forgiveness counted
// month by month, the dates to certify an employer and recertify income, the tax on forgiven
// debt, and whether refinancing makes sense (a federal loan is never refinanced away from
// forgiveness without saying what's lost).

const monthOf = (day: string) => day.slice(0, 7);

export type PslfMonth = { month: string; state: "before" | "seen" | "to_come" };

export type PslfCount = {
  counted: number;
  remaining: number;
  // When the 120th payment is made if the person pays on time every month from here.
  forgivenOn: string | null;
  // A window around today, month by month.
  grid: PslfMonth[];
};

// Counted before (studentaid.gov's count when Jane started) plus one for each month a
// payment was seen, out of PSLF_PAYMENTS.
export function pslfCount(input: {
  countedBefore: number;
  seenMonths: readonly string[];
  asOf: string;
}): PslfCount {
  const seen = new Set(input.seenMonths);
  const counted = Math.min(PSLF_PAYMENTS, input.countedBefore + seen.size);
  const remaining = PSLF_PAYMENTS - counted;
  const thisMonth = monthOf(input.asOf);
  const grid: PslfMonth[] = [];
  for (let i = -LONG_GAME.gridMonthsEachSide; i <= LONG_GAME.gridMonthsEachSide; i += 1) {
    const month = monthOf(addMonths(`${thisMonth}-01`, i));
    grid.push({
      month,
      state: seen.has(month) ? "seen" : month <= thisMonth ? "before" : "to_come",
    });
  }
  return {
    counted,
    remaining,
    forgivenOn: remaining === 0 ? input.asOf : addMonths(`${thisMonth}-01`, remaining),
    grid,
  };
}

// The next date on a yearly cycle that is today or later, from the last one.
export function nextOnCycle(lastOn: string, everyMonths: number, asOf: string): string {
  let next = lastOn;
  for (let i = 1; next < asOf && i < 600; i += 1) next = addMonths(lastOn, i * everyMonths);
  return next;
}

export type TaxOnForgiven = {
  taxable: boolean;
  forgivenCents: number;
  estimateCents: number;
  note: string;
};

export function taxOnForgiven(forgivenCents: number, viaPslf: boolean): TaxOnForgiven {
  const rule = viaPslf ? FORGIVEN_TAX.pslf : FORGIVEN_TAX.idr;
  return {
    taxable: rule.taxable,
    forgivenCents,
    estimateCents: rule.taxable ? Math.round(forgivenCents * LONG_GAME.forgivenTaxRate) : 0,
    note: rule.text,
  };
}

// Whether it's time to put the tax on forgiven debt on the deadlines list: taxable, and
// forgiveness within LONG_GAME.taxPlanYearsAhead years.
export function taxPlanDue(forgivenOn: string, taxable: boolean, asOf: string): boolean {
  return taxable && forgivenOn <= addMonths(asOf, LONG_GAME.taxPlanYearsAhead * 12);
}

export type RefiGuide = {
  verdict: "keep" | "weigh" | "consider";
  lost: string[];
  text: string;
};

// Whether refinancing makes sense. `offer` is the best refinance offer for the loan, if any.
export function refiGuide(input: {
  loanType: "federal" | "private";
  publicService: boolean;
  currentAprBps: number;
  offer: { lender: string; aprBps: number; savingCents: number } | null;
}): RefiGuide {
  const { offer } = input;
  const drop = offer ? input.currentAprBps - offer.aprBps : 0;
  if (input.loanType === "private") {
    if (offer && drop >= LONG_GAME.refiMinDropBps && offer.savingCents > 0) {
      return {
        verdict: "consider",
        lost: [],
        text: `This loan is private, so it has no federal protections to lose. ${offer.lender}'s ${(offer.aprBps / 100).toFixed(2)}% is ${(drop / 100).toFixed(2)} points lower and saves about ${formatCents(offer.savingCents)} over the same months: worth considering.`,
      };
    }
    return {
      verdict: "keep",
      lost: [],
      text: offer
        ? "This loan is private. The best offer isn't far enough below your rate to be worth the paperwork."
        : "This loan is private. I don't have an offer that beats your rate.",
    };
  }
  const lost = [...FEDERAL_PROTECTIONS];
  if (input.publicService) {
    return {
      verdict: "keep",
      lost,
      text: "Don't refinance a federal loan while you're counting payments for Public Service Loan Forgiveness: a private lender ends the forgiveness for good, and every payment counted so far is lost.",
    };
  }
  return {
    verdict: offer && drop >= LONG_GAME.refiMinDropBps ? "weigh" : "keep",
    lost,
    text: `Refinancing this federal loan with a private lender is permanent and gives up ${lost.join("; ")}.${offer && drop >= LONG_GAME.refiMinDropBps ? ` ${offer.lender}'s ${(offer.aprBps / 100).toFixed(2)}% would save about ${formatCents(offer.savingCents)}; weigh that against what you'd lose.` : ""}`,
  };
}
