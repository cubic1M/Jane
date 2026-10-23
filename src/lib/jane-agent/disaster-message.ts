import type { DisasterView, ReliefView } from "@/lib/disasters";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import type { MessageAction, MessageRefs } from "./types";

// Disasters and losses in the chat (spec step 270): a postponement declared for the person's
// county (Jane moves their tax deadlines by herself at the levels that let her act, on a tap at
// "ask first"), the casualty loss after insurance kept with the claim, and the answer to "do I
// get more time on my taxes after the storm", "can I deduct storm damage". Facts: what the IRS
// postponed and the loss rules; nothing is filed.

export const DISASTER_HREF = "/deadlines";

type Message = { body: string; refs: MessageRefs; actions: MessageAction[] };

const day = (d: string) => dayLabel(d, { year: true });
const sample = (r: ReliefView) =>
  r.relief.sample ? " This is a sample declaration from Jane's stand-in disaster feed." : "";

function lossLine(r: ReliefView): string {
  const l = r.loss;
  if (l.repairsCents <= 0)
    return "If it damaged your home or car, keep the repair bills with your insurance claim: a loss insurance doesn't cover can be deductible.";
  const back = l.reimbursedCents > 0 ? `, ${formatCents(l.reimbursedCents)} came back` : "";
  return l.deductibleCents > 0
    ? `You've paid ${formatCents(l.repairsCents)} for repairs since${back}: after the $${l.floorCents / 100} floor and 10% of your income, ${formatCents(l.deductibleCents)} is a deductible casualty loss (Form 4684).`
    : `You've paid ${formatCents(l.repairsCents)} for repairs since${back}: after the $${l.floorCents / 100} floor and 10% of your income (${formatCents(l.incomeFloorCents)}), none of it is deductible. What insurance pays changes that, so keep the bills with the claim.`;
}

export function reliefMessage(v: DisasterView, r: ReliefView): Message {
  const to = day(r.relief.postponedTo);
  const dates = r.computed.map((m) => `${m.title} (${day(m.from)})`).join("; ");
  const what = r.relief.title.replace(/ \(sample declaration\)$/, "").toLowerCase();
  const actions: MessageAction[] = [];
  let lead = `The IRS has postponed federal tax deadlines for ${v.county} County after ${what} from ${day(r.relief.incidentFrom)}, to ${to}.`;
  if (r.applied) {
    lead += " I've moved the tax deadlines on your list that fell in that window there.";
  } else {
    const n = r.moves.length;
    if (n > 0) {
      lead += ` ${n === 1 ? "1 tax deadline" : `${n} tax deadlines`} on your list fall in that window.`;
      actions.push({ id: "tax.disaster_move", label: "Move my tax deadlines", kind: "primary" });
    }
  }
  if (r.loss.repairsCents > 0 && !r.recorded)
    actions.push({
      id: "tax.disaster_loss",
      label: "Keep the loss with my claim",
      kind: "secondary",
    });
  actions.push({ id: "open", label: "See my deadlines", kind: "link", href: DISASTER_HREF });
  return {
    body: `${lead}${dates ? ` That covers ${dates}.` : ""}${r.relief.stateFollows ? " The state's tax agency postponed its deadlines to the same date." : ""} ${lossLine(r)}${sample(r)}`,
    refs: { disasterRelief: r.relief.id, taxYear: v.year },
    actions,
  };
}

// One relief's lines, shared with /taxes/disasters so the page and the chat say the same.
export function reliefLines(r: ReliefView): string[] {
  return [
    `${r.relief.title.replace(/ \(sample declaration\)$/, "")} from ${day(r.relief.incidentFrom)}: federal tax deadlines from then move to ${day(r.relief.postponedTo)}${r.computed.length ? ` (${r.computed.map((m) => `${m.title}, ${day(m.from)}`).join("; ")})` : ""}.${r.applied ? " I've moved the ones on your list." : r.moves.length ? ` ${r.moves.length} on your list can move.` : ""}`,
    lossLine(r) + (r.recorded ? " It's recorded with your insurance claim, once." : "") + sample(r),
  ];
}

const disasterLines = (v: DisasterView) => v.relief.flatMap(reliefLines);

export function disasterReply(v: DisasterView): Message {
  if (!v.feed)
    return {
      body: "I can't check disaster relief for you yet: I only have a sample disaster feed, for the demo bank. The IRS lists every postponement on its \"Tax relief in disaster situations\" page; if your county is on it, your federal tax deadlines move to the date it gives, and a loss insurance doesn't cover may be deductible (Publication 547).",
      refs: {},
      actions: [],
    };
  if (!v.county)
    return {
      body: "Tell me the county you live in (\"I live in Harris County\") and I'll check it against the disaster postponements. If one covers you, your federal tax deadlines move, and a loss insurance doesn't cover may be deductible.",
      refs: {},
      actions: [],
    };
  if (v.relief.length === 0)
    return {
      body: `I don't see a disaster postponement for ${v.county} County right now, so your tax deadlines stay as they are. If a disaster hits, the IRS usually postpones deadlines for the counties named, and I'll move yours when it does.`,
      refs: {},
      actions: [],
    };
  const lines = disasterLines(v);
  const first = v.relief[0];
  const actions: MessageAction[] = [];
  if (!first.applied && first.moves.length > 0)
    actions.push({ id: "tax.disaster_move", label: "Move my tax deadlines", kind: "primary" });
  actions.push({ id: "open", label: "See my deadlines", kind: "link", href: DISASTER_HREF });
  return {
    body: `Here is the disaster relief for ${v.county} County.\n${lines.map((l) => `• ${l}`).join("\n")}`,
    refs: { disasterRelief: first.relief.id },
    actions,
  };
}
