import { dayLabel } from "@/lib/day-label";
import type { FamilyLoans } from "@/lib/family-loans";
import { formatCents } from "@/lib/money";
import type { Reply } from "./replies";
import type { MessageAction } from "./types";

// Jane's answers about money between family and friends (spec step 226), from
// src/lib/family-loans.ts. Pure. Jane never messages the other person: a reminder is text
// for the person to send themselves, and a transfer is a loan only after they say so.

export const FAMILY_PAGE: MessageAction = {
  id: "open",
  label: "Who owes whom",
  kind: "link",
  href: "/loans/family",
};

export const yesButton = (kind: "lent" | "borrowed", name: string): MessageAction => ({
  id: "famloan.yes",
  label: kind === "lent" ? `Yes, I lent ${name} that` : `Yes, ${name} lent me that`,
  kind: "primary",
});
export const noButton = (): MessageAction => ({
  id: "famloan.no",
  label: "No, it wasn't a loan",
  kind: "secondary",
});

export function candidateQuestion(c: FamilyLoans["candidates"][number]): string {
  const t = c.transfer;
  const cents = formatCents(Math.abs(t.amountCents));
  return c.kind === "lent"
    ? `You sent ${c.parsed.counterparty} ${cents} on ${c.parsed.app} on ${dayLabel(t.date)}, ${c.hint}. Was it a loan you'd like paid back? I won't contact ${c.parsed.counterparty.split(" ")[0]}; this stays between us.`
    : `${c.parsed.counterparty} sent you ${cents} on ${c.parsed.app} on ${dayLabel(t.date)}, ${c.hint}. Was it a loan you'll pay back? I won't contact ${c.parsed.counterparty.split(" ")[0]}; this stays between us.`;
}

export function familyLoansReply(data: FamilyLoans): Reply {
  const lines: string[] = [];
  const lent = data.loans.filter((l) => l.kind === "lent");
  const borrowed = data.loans.filter((l) => l.kind === "borrowed");
  if (lent.length > 0) {
    lines.push(
      `People who owe you ${formatCents(lent.reduce((s, l) => s + l.balanceCents, 0))}:`,
      ...lent.map(
        (l) =>
          `- ${l.counterparty}: ${formatCents(l.balanceCents)} of ${formatCents(l.principalCents)} lent on ${dayLabel(l.openedOn)}${l.repaid.length ? `, ${l.repaid.length} paid back` : ""}`,
      ),
    );
  }
  if (borrowed.length > 0) {
    lines.push(
      `You owe ${formatCents(borrowed.reduce((s, l) => s + l.balanceCents, 0))}:`,
      ...borrowed.map(
        (l) =>
          `- ${l.counterparty}: ${formatCents(l.balanceCents)} of ${formatCents(l.principalCents)} borrowed on ${dayLabel(l.openedOn)}`,
      ),
    );
  }
  for (const c of data.cosigned.filter((x) => x.missed)) {
    lines.push(`A payment on the ${c.debtName} you co-signed for ${c.counterparty} looks late.`);
  }
  for (const s of data.shared) {
    if (s.yourShareCents !== null) {
      lines.push(
        `Your half of the shared ${s.name} payment is ${formatCents(s.yourShareCents)} a month.`,
      );
    }
  }
  const first = data.candidates[0];
  if (first) {
    lines.push(candidateQuestion(first));
  }
  if (lines.length === 0) {
    return {
      body: "I don't see any money lent to or borrowed from family or friends. If you send or get a big transfer on Venmo, Zelle or Cash App, I'll ask you whether it was a loan, once.",
      actions: [FAMILY_PAGE],
      refs: {},
    };
  }
  // The first line is always an answer, never a lead-in.
  return {
    body: lines.join("\n"),
    actions: first
      ? [yesButton(first.kind, first.parsed.counterparty.split(" ")[0]), noButton(), FAMILY_PAGE]
      : [FAMILY_PAGE],
    refs: first ? { familyLoan: { id: first.id } } : {},
  };
}
