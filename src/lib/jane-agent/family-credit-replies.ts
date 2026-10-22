import { FAMILY_LABELS } from "@/config/family-credit";
import type { FamilyCredit } from "@/lib/family-credit";
import { formatCents } from "@/lib/money";
import type { Reply } from "./replies";
import type { MessageAction } from "./types";

// Jane's answers about helping family with credit (spec step 249), from
// src/lib/family-credit.ts. Pure. What reporting does with a co-signed loan is a fact; what to
// do for a young person is demo advice; what a lender may do is for a lawyer.

export const FAMILY_CREDIT_PAGE: MessageAction = {
  id: "open",
  label: "Helping with credit",
  kind: "link",
  href: "/loans/helping",
};

const pct = (share: number | null) => (share === null ? null : `${Math.round(share * 100)}%`);

export function cosignLines(d: FamilyCredit): string[] {
  const c = d.cosign;
  const lines = [...d.cosigning.facts.map((f) => `- ${f}`)];
  if (d.entries.some((e) => e.kind === "cosigned")) {
    lines.push(
      `You've co-signed ${formatCents(c.exposureCents)} in all, ${formatCents(c.cosignedPaymentCents)} a month.`,
    );
    if (c.shareWith !== null && c.shareBefore !== null) {
      lines.push(
        `Counted in full, your debt payments go from ${pct(c.shareBefore)} to ${pct(c.shareWith)} of your income.`,
      );
    }
    for (const m of d.missed) {
      lines.push(
        `${m.person} missed a payment: that's on your report too. Paying it yourself keeps your credit clean.`,
      );
    }
  }
  lines.push(d.cosigning.legalNote);
  return lines;
}

export function adviceLines(d: FamilyCredit): string[] {
  const out: string[] = [];
  const best = d.bestCard;
  if (best) {
    const use = best.au.utilisation !== null ? Math.round(best.au.utilisation * 100) : null;
    out.push(
      `- As an authorized user: ${best.name} is the card to add someone to${use !== null ? ` (${use}% used)` : ""}. They can gain up to about ${d.authorizedUser.addedGainsPoints.high} points from its history; you rarely gain. ${d.authorizedUser.primaryRisk}`,
    );
  } else {
    out.push(
      "- As an authorized user: none of your cards is used under 30% of its limit, so adding someone would put high use on their report too. Pay a card down first.",
    );
  }
  out.push(
    `- A first card for a student: ${d.firstCard.under21Rule} Usual choices: ${d.firstCard.options.map((o) => o.label.toLowerCase()).join(", ")}. A file started early could save about ${formatCents(d.fileStartCents)} on a first car loan (a guess).`,
  );
  return out;
}

export function familyCreditReply(d: FamilyCredit): Reply {
  const lines = [
    "Helping someone with credit comes in three ways, and co-signing is the risky one.",
  ];
  if (d.advice) lines.push("The two safer ones:", ...adviceLines(d));
  lines.push("Co-signing:", ...cosignLines(d));
  const kept = d.entries.filter((e) => e.kind !== "cosigned");
  if (kept.length) {
    lines.push(
      "You've told me about: " +
        kept.map((e) => `${FAMILY_LABELS[e.kind].toLowerCase()} for ${e.person}`).join("; ") +
        ".",
    );
  }
  lines.push(
    `Sources: ${d.authorizedUser.source.label}; ${d.cosigning.source.label}; ${d.firstCard.source.label}.`,
  );
  return {
    body: lines.join("\n"),
    actions: [FAMILY_CREDIT_PAGE],
    refs: d.advice ? { advice: true } : {},
  };
}
