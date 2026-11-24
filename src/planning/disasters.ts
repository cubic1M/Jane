import { US_STATES } from "@/config/referrals";
import {
  CASUALTY,
  COUNTY_IN_PAYEE,
  REIMBURSEMENT_PAYEE,
  REPAIR_CATEGORIES,
  REPAIR_PAYEE,
  TAX_DEADLINE_TITLE,
  type Relief,
} from "@/config/disasters";
import { PROPERTY_TAX_PAYEE } from "@/config/home-taxes";
import { ESTIMATED_TAX_DATES } from "@/config/tax-pack";

// Disasters and losses (spec step 270). Pure: which disaster relief covers a person's county,
// which tax deadlines it moves and to when, and the casualty loss after insurance and the
// floors. A loss is counted once per disaster and claim.

const round = Math.round;

// "HARRIS COUNTY TAX ASSESSOR" names Harris County.
export function countyOf(description: string): string | null {
  const m = COUNTY_IN_PAYEE.exec(description.toUpperCase());
  if (!m) return null;
  return m[1]
    .toLowerCase()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// The county a person's property tax goes to, from their payments.
export function countyFromPayments(
  rows: readonly { description: string; amountCents: number }[],
): string | null {
  for (const r of rows) {
    if (r.amountCents <= 0 || !PROPERTY_TAX_PAYEE.test(r.description)) continue;
    const county = countyOf(r.description);
    if (county) return county;
  }
  return null;
}

const sameCounty = (a: string, b: string) =>
  a
    .trim()
    .toLowerCase()
    .replace(/ county$/, "") ===
  b
    .trim()
    .toLowerCase()
    .replace(/ county$/, "");

// Relief that covers the person's county (and state, when known) and still matters: its
// postponed date hasn't passed.
export function reliefFor(
  feed: readonly Relief[],
  where: { county: string | null; state: string | null },
  today: string,
): Relief[] {
  if (!where.county) return [];
  return feed.filter(
    (r) =>
      r.counties.some((c) => sameCounty(c, where.county!)) &&
      (where.state === null || r.state === where.state) &&
      r.postponedTo >= today,
  );
}

// A deadline owned by a state: titled "State income tax return" or with a state's name
// ("California estimated tax payment"), and not as the IRS's or federal.
const FEDERAL_TITLE = /\b(?:IRS|federal)\b/i;
// Where `word` first appears in `text` as a whole word (not inside "Maineville"), or -1.
function wholeWordAt(text: string, word: string): number {
  const letter = /[a-z]/;
  for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + 1)) {
    const before = at === 0 ? "" : text[at - 1]!;
    const after = text[at + word.length] ?? "";
    if (!letter.test(before) && !letter.test(after)) return at;
  }
  return -1;
}

// The state a title names first ("Texas estimated tax payment (Washington County)" is Texas's);
// where two names start at the same place the longer wins ("West Virginia", not "Virginia").
const stateIn = (title: string) => {
  const lower = title.toLowerCase();
  let best: { state: (typeof US_STATES)[number]; at: number } | null = null;
  for (const s of US_STATES) {
    const at = wholeWordAt(lower, s.name.toLowerCase());
    if (at < 0) continue;
    if (!best || at < best.at || (at === best.at && s.name.length > best.state.name.length))
      best = { state: s, at };
  }
  return best?.state ?? null;
};
const SAYS_STATE = /\bstate\b/i;

// Whether the relief moves a deadline by who owns it: a federal one always; one naming a state
// only for that state's own relief, and only when the state follows; one saying just "state"
// under a state that follows.
function movedByOwner(r: Relief, title: string): boolean {
  if (FEDERAL_TITLE.test(title)) return true;
  const named = stateIn(title);
  if (named) return named.code === r.state && r.stateFollows;
  if (SAYS_STATE.test(title)) return r.stateFollows;
  return true;
}

// A deadline the relief moves: one falling from the incident to the postponed date.
export const covers = (r: Relief, dueOn: string) =>
  dueOn >= r.incidentFrom && dueOn < r.postponedTo;

export type Move = { id: string; title: string; from: string; to: string };

// Every tax deadline on the person's list the relief moves, not yet done.
export function deadlineMoves(
  r: Relief,
  deadlines: readonly { id: string; title: string; dueOn: string; done: boolean }[],
): Move[] {
  return deadlines
    .filter(
      (d) =>
        !d.done &&
        TAX_DEADLINE_TITLE.test(d.title) &&
        movedByOwner(r, d.title) &&
        covers(r, d.dueOn),
    )
    .map((d) => ({ id: d.id, title: d.title, from: d.dueOn, to: r.postponedTo }));
}

// The federal dates Jane works out itself that the relief moves: each estimated payment, and
// filing day with the prior year's IRA and HSA contributions.
export function computedMoves(r: Relief, years: readonly number[]): Move[] {
  const out: Move[] = [];
  for (const year of years) {
    for (const d of ESTIMATED_TAX_DATES) {
      const due = `${year + (d.nextYear ? 1 : 0)}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
      if (covers(r, due))
        out.push({
          id: `estimated:${due}`,
          title: `the estimated tax payment for ${year}`,
          from: due,
          to: r.postponedTo,
        });
    }
    const filing = `${year + 1}-04-15`;
    if (covers(r, filing))
      out.push({
        id: `filing:${year}`,
        title: `your ${year} return, any tax due, and ${year} IRA and HSA contributions`,
        from: filing,
        to: r.postponedTo,
      });
  }
  const seen = new Set<string>();
  return out
    .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
    .sort((a, b) => a.from.localeCompare(b.from));
}

export type CasualtyLoss = {
  repairsCents: number;
  reimbursedCents: number;
  // What insurance and assistance didn't cover.
  lossCents: number;
  floorCents: number;
  incomeFloorCents: number;
  deductibleCents: number;
};

// A personal casualty loss from a declared disaster: less what was paid back, less $100 (or
// $500 for a qualified disaster loss), less 10% of adjusted gross income (not for a qualified
// one).
export function casualtyLoss(input: {
  repairsCents: number;
  reimbursedCents: number;
  agiCents: number;
  relief: Pick<Relief, "federallyDeclared" | "qualified">;
}): CasualtyLoss {
  const loss = Math.max(0, input.repairsCents - input.reimbursedCents);
  const floor = input.relief.qualified ? CASUALTY.qualifiedFloorCents : CASUALTY.perEventFloorCents;
  const incomeFloor = input.relief.qualified ? 0 : round(input.agiCents * CASUALTY.agiShare);
  const deductible = input.relief.federallyDeclared ? Math.max(0, loss - floor - incomeFloor) : 0;
  return {
    repairsCents: input.repairsCents,
    reimbursedCents: input.reimbursedCents,
    lossCents: loss,
    floorCents: floor,
    incomeFloorCents: incomeFloor,
    deductibleCents: deductible,
  };
}

// Repairs paid since the incident, and what came back for them.
export function damageSince(
  rows: readonly { date: string; amountCents: number; description: string; pfc: string | null }[],
  from: string,
): { repairsCents: number; reimbursedCents: number; repairs: number } {
  let repairs = 0;
  let count = 0;
  let back = 0;
  for (const t of rows) {
    if (t.date < from) continue;
    if (
      t.amountCents > 0 &&
      (REPAIR_CATEGORIES.includes(t.pfc ?? "") || REPAIR_PAYEE.test(t.description))
    ) {
      repairs += t.amountCents;
      count += 1;
    } else if (t.amountCents < 0 && REIMBURSEMENT_PAYEE.test(t.description)) {
      back += -t.amountCents;
    }
  }
  return { repairsCents: repairs, reimbursedCents: back, repairs: count };
}
