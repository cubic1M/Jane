import { DEMO_ADVICE_LABEL } from "@/config/advice";
import { CARD_HEADLINE_WORDS } from "@/config/floating-cards";
import type { CardDetails, OptionCardData, OptionSet } from "@/lib/floating-cards";
import type { CardOption, OptionCard } from "@/lib/option-card";

// The one adapter from a lane's pick-one card (src/lib/option-card.ts: insurance and loans
// build them) to the floating pick card (src/lib/floating-cards.ts). The chat shows every
// option set through here, so a lane never draws its own.
//
// - The headline is the option's name with its price: "Lighthouse, $1,272/yr". At most
//   CARD_HEADLINE_WORDS words and one dollar figure.
// - whyThisOne is the one-line summary.
// - The facts and the details are behind More details.
// - Her pick and how sure she is show only when the card carries them (demo advice mode),
//   always with the demo advice label.
// - The pick first, then the rest by price, cheapest first.

const PERIOD = { year: "/yr", month: "/mo" } as const;

// "$1,272" for whole dollars, "$1,272.50" otherwise.
function price(cents: number): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

// The lane's headline without its own dollar figure ("Lighthouse, $1,272.00 a year" →
// "Lighthouse"), so the price is the one figure on the card.
function nameOf(o: CardOption): string {
  const kept = o.headline
    .split(/,\s+/)
    .filter((part) => !/\$\s?[\d,]/.test(part))
    .join(", ")
    .trim();
  return kept || o.label;
}

export function optionHeadline(o: CardOption): string {
  // Paying off with cash costs nothing a month: its own figure (what it saves) is the one.
  if (o.priceCents <= 0) return trim(o.headline, []);
  const tail = `${price(o.priceCents)}${PERIOD[o.pricePeriod]}`;
  return trim(`${nameOf(o)},`, [tail]);
}

// Drops words from the end of the name until the whole line fits.
function trim(name: string, tail: string[]): string {
  const head = words(name);
  while (head.length > 1 && head.length + tail.length > CARD_HEADLINE_WORDS) head.pop();
  return [...head, ...tail].join(" ").replace(/,$/, "");
}

// "APR: 6.90% fixed" is a labelled figure; anything else is a line of its own.
function split(lines: string[]): { figures: { label: string; value: string }[]; notes: string[] } {
  const figures: { label: string; value: string }[] = [];
  const notes: string[] = [];
  for (const line of lines) {
    const at = line.indexOf(": ");
    if (at > 0 && at < 40 && !/^[+−-]\s/.test(line)) {
      figures.push({ label: line.slice(0, at), value: line.slice(at + 2) });
    } else notes.push(line);
  }
  return { figures, notes };
}

const WHAT_A_PICK_DOES: Record<OptionCard["kind"], string> = {
  insurance:
    "Jane's team sets it up with the insurer by hand. Your cover doesn't change until they confirm it with you.",
  loan: "Jane's team sends you the lender's own steps; you apply yourself. Nothing is applied for or moved.",
};

function detailsOf(card: OptionCard, o: CardOption): CardDetails {
  const facts = split(o.facts);
  const advice = card.advice && (o.isPick || o.confidence !== undefined);
  const notes = [...facts.notes, ...o.details].filter((n) => n !== DEMO_ADVICE_LABEL);
  return {
    ...(facts.figures.length > 0 ? { figures: facts.figures } : {}),
    ...(card.advice && o.confidence ? { confidence: o.confidence } : {}),
    whatYesDoes: WHAT_A_PICK_DOES[card.kind],
    notes: advice || card.advice ? [...notes, DEMO_ADVICE_LABEL] : notes,
  };
}

// The pick first, then by price (cheapest first); options of the same price keep their order.
export function orderedOptions(card: OptionCard): CardOption[] {
  return card.options
    .map((o, i) => ({ o, i }))
    .sort(
      (a, b) =>
        Number(card.advice && b.o.isPick) - Number(card.advice && a.o.isPick) ||
        a.o.priceCents - b.o.priceCents ||
        a.i - b.i,
    )
    .map(({ o }) => o);
}

export function toOptionSet(card: OptionCard): OptionSet {
  return {
    title: card.title,
    options: orderedOptions(card).map((o): OptionCardData => ({
      id: o.id,
      headline: optionHeadline(o),
      summary: o.whyThisOne,
      details: detailsOf(card, o),
      ...(card.advice && o.isPick ? { badge: "Jane's pick" } : {}),
      yesLabel: "Pick this one",
      notNowLabel: "Later",
    })),
  };
}
