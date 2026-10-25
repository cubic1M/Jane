import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { WORKED_MIN_SAMPLE, WORKED_QUIET_PER_RUN } from "@/config/worked";
import { formatCents } from "@/lib/money";
import type { Candidate, MessageAction } from "../types";
import type { Snapshot, SnapshotFinding } from "../snapshot";
import { rankedFor } from "../priorities";
import { sentence, type MessageSource } from "./source";

// New findings worth deciding (spec step 82): each open finding once, the biggest yearly
// saving first (time-sensitive ones rank higher), with Jane's pick when it compared the
// options. Buttons: Yes, No, the pick, and Open for the full card.

function pickSentence(pick: NonNullable<SnapshotFinding["pick"]>): string {
  return pick.savings
    ? `My pick: ${pick.name}, which earns about ${formatCents(pick.savingCents)} more a year.`
    : `My pick: ${pick.name}, which saves about ${formatCents(pick.savingCents)} in the first year.`;
}

// Spec step 92: what a bundle's button calls it ("Yes: Netflix").
const NAMES: readonly RegExp[] = [
  /^Review your (.+?) subscription$/,
  /^Your (.+?) (?:phone |internet and TV |internet |TV )?bill is above/,
  /^(.+?) went up from/,
  /^Charged twice\? .* at (.+)$/,
  /in fees on (.+?) in the last/,
  /^Your (.+?) insurance could cost less$/,
];
export function shortName(title: string): string {
  for (const pattern of NAMES) {
    const name = pattern.exec(title)?.[1];
    if (name) return name;
  }
  return title.length <= 28 ? title : `${title.slice(0, 27).trimEnd()}…`;
}

// Spec step 143: most important first, by the priority engine (money per minute of the
// person's time, urgency, confidence), not just the biggest saving.
const byPriority = (snapshot: Snapshot) => {
  const order = new Map(rankedFor(snapshot).map((r, i) => [r.key, i]));
  const at = (f: SnapshotFinding) => order.get(`finding:${f.findingId}`) ?? Number.MAX_SAFE_INTEGER;
  return (a: SnapshotFinding, b: SnapshotFinding) => at(a) - at(b);
};

// One finding as Jane's question about it. Also how she answers about it when asked
// (spec step 88), whatever else is waiting.
// Read-only mode: a real account is offered Jane's steps, never her doing it for them.
export const ASK_TO_HANDLE = "Want me to handle it?";
export const ASK_FOR_STEPS = "Want the steps to do it yourself?";

export function findingCandidate(finding: SnapshotFinding, concierge = true): Candidate {
  const actions: MessageAction[] = [{ id: "finding.yes", label: "Yes", kind: "primary" }];
  if (finding.pick) {
    actions.push({
      id: "finding.pick",
      label: `Switch to ${finding.pick.name}`,
      kind: "primary",
    });
  }
  actions.push(
    { id: "finding.no", label: "No", kind: "secondary" },
    // Spec step 90: quick replies, answered in the chat.
    { id: "finding.why", label: "Why?", kind: "quick" },
    ...(finding.pick
      ? [{ id: "finding.options" as const, label: "Show options", kind: "quick" as const }]
      : []),
    // Spec step 91: No for good.
    { id: "suggest.never", label: "Don't suggest again", kind: "secondary" },
    { id: "open", label: "Open", kind: "link", href: `/report/${finding.findingId}` },
  );
  return {
    kind: "decision",
    body: [
      sentence(finding.title),
      sentence(finding.savings),
      finding.pick ? pickSentence(finding.pick) : null,
      concierge ? ASK_TO_HANDLE : ASK_FOR_STEPS,
    ]
      .filter(Boolean)
      .join(" "),
    refs: {
      findingId: finding.findingId,
      fingerprint: finding.fingerprint,
      ...(finding.pick ? { pickOptionId: finding.pick.optionId } : {}),
    },
    actions,
    dedupeKey: finding.findingId,
    priority: finding.urgent ? MESSAGE_PRIORITY.urgent_finding : MESSAGE_PRIORITY.finding,
    // Spec step 92: findings of one kind go together.
    bundle: {
      group: finding.type,
      name: shortName(finding.title),
      // The title alone when there's no dollar figure to add ("Demo Checking could drop to
      // -$470.80 around Nov 14", not "…: no dollar estimate for this one").
      line:
        finding.annualSavingsCents === null && finding.type !== "insurance_reshop"
          ? sentence(finding.title).replace(/\.$/, "")
          : `${sentence(finding.title).replace(/\.$/, "")}: ${finding.savings.charAt(0).toLowerCase()}${finding.savings.slice(1)}`,
      cents: finding.annualSavingsCents,
    },
  };
}

export const findingsSource: MessageSource = {
  key: "findings",
  gather(snapshot) {
    // Spec step 97: a finding a change's heads-up asks about (./changes.ts) isn't asked twice.
    const askedByChange = new Set(
      (snapshot.changes ?? []).flatMap((c) =>
        c.finding && !c.finding.handledBy ? [c.finding.id] : [],
      ),
    );
    // Spec step 104: when Jane shops insurance herself, her own reshop asks instead of the
    // generic "could cost less" finding.
    const shopsInsurance = snapshot.insurance?.shopsItself ?? false;
    // Spec step 207 read by step 147: a kind whose finished actions never showed a saving is
    // asked about one at a time, not all at once.
    const quiet = new Set(
      (snapshot.worked ?? [])
        .filter((k) => k.done >= WORKED_MIN_SAMPLE && k.worked === 0 && k.notShown > 0)
        .map((k) => k.type),
    );
    const askedQuiet = new Map<string, number>();
    return [...snapshot.findings]
      .filter((finding) => !askedByChange.has(finding.findingId))
      .filter((finding) => !(shopsInsurance && finding.type === "insurance_reshop"))
      .sort(byPriority(snapshot))
      .filter((finding) => {
        if (!quiet.has(finding.type)) return true;
        const asked = askedQuiet.get(finding.type) ?? 0;
        askedQuiet.set(finding.type, asked + 1);
        return asked < WORKED_QUIET_PER_RUN;
      })
      .map((finding) => findingCandidate(finding, snapshot.concierge ?? true));
  },
};
