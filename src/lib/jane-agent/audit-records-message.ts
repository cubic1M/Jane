import type { AuditRecordsView } from "@/lib/audit-records";
import { formatCents } from "@/lib/money";
import type { Retention } from "@/planning/audit-records";
import { shortDate } from "./sources/source";
import type { MessageAction, MessageRefs } from "./types";

// Audit-ready records in the chat (spec step 171): a year's records that can go soon, the
// audit pack and what it still needs, and "how long should I keep my tax records".

export const RECORDS_HREF = "/taxes#records";

type Message = { body: string; refs: MessageRefs; actions: MessageAction[] };

export function retentionMessage(r: Retention): Message {
  const can = r.status === "can_go";
  return {
    body: can
      ? `Your ${r.year} tax records (${r.rule.toLowerCase()}) passed their keep-until date of ${shortDate(r.keepUntil)}. Check nothing's needed for a later year, then you can throw them away. I never delete anything. Want a reminder on your deadlines?`
      : `Your ${r.year} tax records can be thrown away after ${shortDate(r.keepUntil)} (${r.rule.toLowerCase()}). I never delete anything; want a reminder on your deadlines?`,
    refs: { taxYear: r.year },
    actions: [
      { id: "tax.records_remind", label: "Remind me", kind: "primary" },
      { id: "open", label: "See my records", kind: "link", href: `${RECORDS_HREF}` },
    ],
  };
}

export function recordsReply(view: AuditRecordsView): Message {
  const total = view.items.reduce((s, i) => s + i.claimedCents, 0);
  const lines = view.items.map(
    (i) =>
      `• ${i.label}: ${formatCents(i.claimedCents)}, ${i.evidence.length} ${i.evidence.length === 1 ? "source" : "sources"}${i.needs.length > 0 ? ` (still needed: ${i.needs.join(" ")})` : ""}`,
  );
  const gaps = view.gaps.map(
    (g) => `• ${g.label}: ${formatCents(g.claimedCents)} with no source yet (${g.needs.join(" ")})`,
  );
  const keep = view.retention.find((r) => r.year === view.year);
  return {
    body: [
      view.items.length === 0
        ? `I don't have any deductions or credits for ${view.year} to back up yet.`
        : `Your ${view.year} audit pack covers ${formatCents(total)} of deductions and credits, each tied to its sources:\n${lines.join("\n")}`,
      ...(gaps.length > 0
        ? [`Counted but not in the pack for lack of a source:\n${gaps.join("\n")}`]
        : []),
      keep
        ? `Keep these records until ${shortDate(keep.keepUntil)} (${keep.rule.toLowerCase()}).`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
    refs: {},
    actions: [
      {
        id: "open",
        label: "Download the audit pack",
        kind: "link",
        href: `/taxes/audit-pack/download?year=${view.year}`,
      },
      { id: "open", label: "See my records", kind: "link", href: RECORDS_HREF },
    ],
  };
}
