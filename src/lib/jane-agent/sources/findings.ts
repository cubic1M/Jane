import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { formatCents } from "@/lib/money";
import type { Candidate, MessageAction } from "../types";
import type { SnapshotFinding } from "../snapshot";
import { sentence, type MessageSource } from "./source";

// New findings worth deciding (spec step 82): each open finding once, the biggest yearly
// saving first (time-sensitive ones rank higher), with Jane's pick when it compared the
// options. Buttons: Yes, No, the pick, and Open for the full card.

function pickSentence(pick: NonNullable<SnapshotFinding["pick"]>): string {
  return pick.savings
    ? `My pick: ${pick.name}, which earns about ${formatCents(pick.savingCents)} more a year.`
    : `My pick: ${pick.name}, which saves about ${formatCents(pick.savingCents)} in the first year.`;
}

const bySavings = (a: SnapshotFinding, b: SnapshotFinding) =>
  (b.annualSavingsCents ?? -1) - (a.annualSavingsCents ?? -1);

// One finding as Jane's question about it. Also how she answers about it when asked
// (spec step 88), whatever else is waiting.
export function findingCandidate(finding: SnapshotFinding): Candidate {
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
      "Want me to handle it?",
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
    return [...snapshot.findings]
      .filter((finding) => !askedByChange.has(finding.findingId))
      .filter((finding) => !(shopsInsurance && finding.type === "insurance_reshop"))
      .sort(bySavings)
      .map(findingCandidate);
  },
};
