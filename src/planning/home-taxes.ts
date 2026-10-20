import { ENERGY_CREDITS_2025, ENERGY_CREDITS_END, ITEMIZED } from "@/config/tax-rates";
import { HOME_OFFICE_SIMPLIFIED } from "@/config/tax-rates";
import { HOME_SALE_EXCLUSION, MORTGAGE_DEBT_LIMIT } from "@/config/home-taxes";
import type { FilingStatus } from "@/config/tax";

// Homeowner taxes (spec step 170). Pure. What a home changes at tax time, each figure with
// the transactions, loan, documents or answers it comes from: mortgage interest (on up to
// the debt limit), property tax, the state and local tax cap applied to both, points, the
// home office, energy credits from purchases, and the gain on a sale against the exclusion.

export type Source =
  | { kind: "transaction"; id: string; date: string; payee: string; cents: number }
  | { kind: "loan"; name: string; cents: number }
  | { kind: "document"; key: string; form: string; from: string; cents: number }
  | { kind: "answer"; label: string };

export type Figure = { label: string; cents: number; sources: Source[]; note?: string };

export type HomeInput = {
  year: number;
  status: FilingStatus;
  agiCents: number;
  // Mortgage interest: the lender's 1098 (when Jane collected one that checks out), else
  // what the bank reports for the year; and the loan's balance for the debt limit.
  mortgage: {
    name: string;
    ytdInterestCents: number | null;
    balanceCents: number | null;
    form1098: { key: string; from: string; cents: number; points: number } | null;
  } | null;
  propertyTax: { id: string; date: string; payee: string; cents: number }[];
  // State income tax withheld and paid for the year (from pay stubs and payments).
  stateIncomeTaxCents: number;
  // Points paid this year, and whether on a purchase (else a refinance over loanYears).
  points: { cents: number; purchase: boolean; loanYears: number } | null;
  homeOfficeSqFt: number | null;
  energy: { id: string; date: string; payee: string; cents: number; uncapped: boolean }[];
  sale: {
    boughtOn: string;
    priceCents: number;
    soldOn: string;
    saleCents: number;
    costsCents: number;
    improvements: { id: string; date: string; payee: string; cents: number }[];
    // Days lived in it as the main home in the 5 years before the sale.
    daysLivedIn: number;
  } | null;
};

export type HomeTaxes = {
  mortgageInterest: Figure | null;
  propertyTax: Figure | null;
  salt: {
    stateIncome: Figure;
    property: Figure | null;
    totalCents: number;
    capCents: number;
    // What counts: the total, up to the cap.
    allowedCents: number;
    overCents: number;
  };
  points: Figure | null;
  homeOffice: Figure | null;
  energy: Figure[];
  sale: {
    basis: Figure;
    sale: Figure;
    gainCents: number;
    exclusionCents: number;
    taxableGainCents: number;
    qualifies: boolean;
    why: string[];
  } | null;
};

const DAY_MS = 86_400_000;
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY_MS;

// The cap on state and local taxes (the same as the estimate's), shrinking above the
// phase-down income to the floor.
export function saltCap(agiCents: number, status: FilingStatus): number {
  const separate = status === "married_separate";
  const cap = separate ? ITEMIZED.saltCap.marriedSeparate : ITEMIZED.saltCap.normal;
  const from = separate
    ? ITEMIZED.saltPhaseDownFrom.marriedSeparate
    : ITEMIZED.saltPhaseDownFrom.normal;
  const floor = separate ? ITEMIZED.saltFloor.marriedSeparate : ITEMIZED.saltFloor.normal;
  return Math.max(
    floor,
    cap - Math.round(Math.max(0, agiCents - from) * ITEMIZED.saltPhaseDownRate),
  );
}

export function homeTaxes(h: HomeInput): HomeTaxes {
  // Mortgage interest, limited to the share of the loan under the debt limit.
  let mortgageInterest: Figure | null = null;
  const m = h.mortgage;
  if (m) {
    const source: Source | null = m.form1098
      ? {
          kind: "document",
          key: m.form1098.key,
          form: "1098",
          from: m.form1098.from,
          cents: m.form1098.cents,
        }
      : m.ytdInterestCents !== null
        ? { kind: "loan", name: m.name, cents: m.ytdInterestCents }
        : null;
    if (source) {
      const limit =
        h.status === "married_separate"
          ? MORTGAGE_DEBT_LIMIT.marriedSeparate
          : MORTGAGE_DEBT_LIMIT.normal;
      const share = m.balanceCents && m.balanceCents > limit ? limit / m.balanceCents : 1;
      mortgageInterest = {
        label: "Mortgage interest",
        cents: Math.round(source.cents * share),
        sources: [source],
        note:
          share < 1
            ? `Only the interest on the first $${(limit / 100).toLocaleString("en-US")} of the loan counts.`
            : undefined,
      };
    }
  }

  const propertyTotal = h.propertyTax.reduce((s, p) => s + p.cents, 0);
  const propertyTax: Figure | null =
    h.propertyTax.length > 0
      ? {
          label: "Property tax",
          cents: propertyTotal,
          sources: h.propertyTax.map((p) => ({ kind: "transaction" as const, ...p })),
        }
      : null;

  const stateIncome: Figure = {
    label: "State and local income tax",
    cents: h.stateIncomeTaxCents,
    sources: [{ kind: "answer", label: "Withheld on your pay stubs and paid to the state" }],
  };
  const totalCents = h.stateIncomeTaxCents + propertyTotal;
  const capCents = saltCap(h.agiCents, h.status);
  const allowedCents = Math.min(totalCents, capCents);

  const points: Figure | null = h.points
    ? {
        label: h.points.purchase ? "Points on your purchase" : "Points on your refinance",
        cents: h.points.purchase
          ? h.points.cents
          : Math.round(h.points.cents / Math.max(1, h.points.loanYears)),
        sources:
          m?.form1098 && m.form1098.points > 0
            ? [
                {
                  kind: "document",
                  key: m.form1098.key,
                  form: "1098",
                  from: m.form1098.from,
                  cents: m.form1098.points,
                },
              ]
            : [{ kind: "answer", label: "The points you told Jane about" }],
        note: h.points.purchase ? undefined : `Spread over the loan's ${h.points.loanYears} years.`,
      }
    : null;

  const homeOffice: Figure | null =
    h.homeOfficeSqFt && h.homeOfficeSqFt > 0
      ? {
          label: "Home office (simplified method)",
          cents:
            Math.min(h.homeOfficeSqFt, HOME_OFFICE_SIMPLIFIED.maxSquareFeet) *
            HOME_OFFICE_SIMPLIFIED.perSquareFoot,
          sources: [
            { kind: "answer", label: `${h.homeOfficeSqFt} square feet, on your tax profile` },
          ],
          note: "For self-employment income only.",
        }
      : null;

  // Energy credits: 30% of work placed in service by the end date (capped for
  // improvements); none after.
  const energy: Figure[] = h.energy.map((e) => {
    const inTime = e.date <= ENERGY_CREDITS_END.home;
    const credit = inTime
      ? Math.round(
          e.uncapped
            ? e.cents * ENERGY_CREDITS_2025.rate
            : Math.min(e.cents * ENERGY_CREDITS_2025.rate, ENERGY_CREDITS_2025.improvementCap),
        )
      : 0;
    return {
      label: `Energy credit: ${e.payee}`,
      cents: credit,
      sources: [{ kind: "transaction", id: e.id, date: e.date, payee: e.payee, cents: e.cents }],
      note: inTime
        ? undefined
        : `Home energy credits ended for work after ${ENERGY_CREDITS_END.home}.`,
    };
  });

  let sale: HomeTaxes["sale"] = null;
  if (h.sale) {
    const s = h.sale;
    const improvements = s.improvements.reduce((sum, i) => sum + i.cents, 0);
    const basisCents = s.priceCents + improvements;
    const why: string[] = [];
    const owned = days(s.boughtOn, s.soldOn);
    if (owned < HOME_SALE_EXCLUSION.daysOfFiveYears) {
      why.push("You must have owned it for 2 of the 5 years before the sale.");
    }
    if (s.daysLivedIn < HOME_SALE_EXCLUSION.daysOfFiveYears) {
      why.push("You must have lived in it as your main home for 2 of the 5 years before the sale.");
    }
    const qualifies = why.length === 0;
    const gainCents = s.saleCents - s.costsCents - basisCents;
    const exclusionCents = qualifies
      ? h.status === "married_joint"
        ? HOME_SALE_EXCLUSION.marriedJoint
        : HOME_SALE_EXCLUSION.normal
      : 0;
    sale = {
      basis: {
        label: "What the home cost you (basis)",
        cents: basisCents,
        sources: [
          { kind: "answer", label: `Bought on ${s.boughtOn}` },
          ...s.improvements.map((i) => ({ kind: "transaction" as const, ...i })),
        ],
      },
      sale: {
        label: "Sale price less selling costs",
        cents: s.saleCents - s.costsCents,
        sources: [{ kind: "answer", label: `Sold on ${s.soldOn}` }],
      },
      gainCents,
      exclusionCents,
      taxableGainCents: Math.max(0, gainCents - exclusionCents),
      qualifies,
      why,
    };
  }

  return {
    mortgageInterest,
    propertyTax,
    salt: {
      stateIncome,
      property: propertyTax,
      totalCents,
      capCents,
      allowedCents,
      overCents: totalCents - allowedCents,
    },
    points,
    homeOffice,
    energy,
    sale,
  };
}

// Every figure, for "each one links to where it came from".
export function figuresOf(t: HomeTaxes): Figure[] {
  return [
    t.mortgageInterest,
    t.propertyTax,
    t.salt.stateIncome,
    t.points,
    t.homeOffice,
    ...t.energy,
    t.sale?.basis ?? null,
    t.sale?.sale ?? null,
  ].filter((f): f is Figure => f !== null);
}
