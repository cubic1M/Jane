import { PMI_ASK_LTV, PMI_AUTO_LTV } from "@/config/home-equity";
import { PROJECT_NOTES, PROJECT_PRODUCTS } from "@/config/home-equity";
import { dayLabel } from "@/lib/day-label";
import type { HomeEquity, ProjectComparison } from "@/lib/home-equity";
import { formatCents } from "@/lib/money";
import { cheapest, type PmiTimeline } from "@/planning/home-equity";
import type { Reply } from "./replies";
import type { MessageAction } from "./types";

// Jane's answers about a home's equity (spec step 228), from src/lib/home-equity.ts. Pure.
// PMI and escrow are rules she can state for anyone; comparing ways to borrow for a project
// is advice, so it is demo advice mode only and carries the label.

export const EQUITY_PAGE: MessageAction = {
  id: "open",
  label: "Your home loan",
  kind: "link",
  href: "/loans/equity",
};

export const sentButton = (which: "pmi" | "escrow"): MessageAction => ({
  id: "homeeq.sent",
  label: which === "pmi" ? "I sent the PMI request" : "I sent the escrow request",
  kind: "primary",
});

const pct = (share: number) => `${Math.round(share * 1000) / 10}%`;

export const pmiLines = (data: HomeEquity): string[] =>
  data.pmi ? pmiTimelineLines(data.pmi) : [];

// PMI by the one rule, the same lines on /loans/mortgage, /loans/equity and in the chat.
export function pmiTimelineLines(p: PmiTimeline): string[] {
  const lines = [
    `Your loan is ${formatCents(p.balanceCents)}, ${pct(p.ltv)} of the home's original value of ${formatCents(p.originalValueCents)}.`,
  ];
  if (p.endsNow) {
    lines.push(
      `That's under ${pct(PMI_AUTO_LTV)}, the point where PMI has to end by itself when your payments are current. If it's still on your statement, ask your servicer why.`,
    );
  } else if (p.canAskNow) {
    lines.push(
      `That's under ${pct(PMI_ASK_LTV)}, so you can ask your servicer in writing to cancel PMI. I drafted the request below. It ends by itself at ${pct(PMI_AUTO_LTV)} (${formatCents(p.autoBalanceCents)})${p.autoOn ? `, around ${dayLabel(p.autoOn, { year: true })} at your current payment` : ""}.`,
    );
  } else {
    lines.push(
      `You can ask your servicer to cancel PMI at ${pct(PMI_ASK_LTV)} (${formatCents(p.askBalanceCents)})${p.askOn ? `, around ${dayLabel(p.askOn, { year: true })} at your current payment` : ""}. It ends by itself at ${pct(PMI_AUTO_LTV)} (${formatCents(p.autoBalanceCents)})${p.autoOn ? `, around ${dayLabel(p.autoOn, { year: true })}` : ""}.`,
    );
  }
  return lines;
}

export function escrowLines(data: HomeEquity): string[] {
  const e = data.escrow;
  if (!e) return [];
  if (e.kind === "unknown") {
    return e.why === "no_bills"
      ? ["Tell me your yearly property tax and insurance bills and I'll check your escrow."]
      : [
          "I can't split your payment into loan and escrow without the loan's starting amount and rate, so I can't check the escrow yet.",
        ];
  }
  const lines = [
    `Your tax and insurance bills come to ${formatCents(e.billsCents)} a year, and your payment puts ${formatCents(e.monthlyEscrowCents)} a month (${formatCents(e.collectedYearlyCents)} a year) into escrow.`,
  ];
  if (e.kind === "over") {
    lines.push(
      e.surplusCents > 0
        ? `Your servicer is holding about ${formatCents(e.surplusCents)} more than a year of bills and the two-month cushion the rules allow. A surplus of $50 or more is refunded after the escrow analysis, and I drafted the request.`
        : `That's ${formatCents(e.gapYearlyCents)} a year more than the bills. You can ask for an escrow analysis and a lower payment, and I drafted the request.`,
    );
  } else if (e.kind === "short") {
    lines.push(
      `That's ${formatCents(-e.gapYearlyCents)} a year less than the bills, so expect your payment to go up at the next escrow analysis.`,
    );
  } else {
    lines.push("That's about right for the bills. Nothing to ask for.");
  }
  return lines;
}

function projectLines(c: ProjectComparison): string[] {
  const best = cheapest(c.options);
  const lines = [
    best
      ? `For ${formatCents(c.projectCents)} of work over ${c.years} years, the ${PROJECT_PRODUCTS[best.product].name} has the lowest total cost, ${formatCents(best.totalCostCents)} in interest and fees.`
      : `For ${formatCents(c.projectCents)} of work over ${c.years} years, none of the three ways fits your home and loans.`,
    "The total cost of each way, interest and fees included:",
  ];
  for (const o of c.options) {
    lines.push(
      o.available
        ? `- ${o.label}: ${formatCents(o.totalCostCents)} total cost, ${formatCents(o.monthlyCents)} a month at ${pct(o.aprBps / 10_000)}${o.product === "cash_out" ? " (your whole new mortgage payment, 30 years)" : ""}, ${formatCents(o.upfrontCents)} up front.`
        : `- ${o.label}: not an option here. ${o.why}`,
    );
  }
  if (best) lines.push(PROJECT_NOTES[best.product]);
  lines.push("These are stand-in lender terms, not offers.");
  return lines;
}

export function homeEquityReply(
  data: HomeEquity,
  topic: "pmi" | "escrow" | "project",
  project: ProjectComparison | null,
): Reply {
  if (!data.available) {
    return {
      body: "I don't see a mortgage with a balance, so there's no PMI, escrow or home equity to look at yet.",
      actions: [],
      refs: {},
    };
  }
  if (topic === "project") {
    if (!data.advice) {
      return {
        body: "Comparing ways to borrow against your home is advice, and I only give it for the demo bank. Your home loan page has the facts on each kind.",
        actions: [EQUITY_PAGE],
        refs: {},
      };
    }
    if (!project) {
      return {
        body: `Tell me what the project costs, like "a HELOC or a cash-out refinance for a $40,000 kitchen", and I'll compare the total cost of a HELOC, a cash-out refinance and a personal loan.`,
        actions: [EQUITY_PAGE],
        refs: { advice: true },
      };
    }
    return {
      body: projectLines(project).join("\n"),
      actions: [EQUITY_PAGE],
      refs: { advice: true },
    };
  }
  if (topic === "pmi") {
    if (data.hasPmi === false) {
      return { body: "Your bank says your loan has no PMI.", actions: [EQUITY_PAGE], refs: {} };
    }
    if (data.hasPmi === null) {
      return {
        body: "Your bank doesn't say whether your loan has PMI. Your annual statement does.",
        actions: [EQUITY_PAGE],
        refs: {},
      };
    }
    if (!data.pmi) {
      return {
        body: `PMI is measured against the home's value when the loan began: you can ask to cancel it at ${pct(PMI_ASK_LTV)} and it ends by itself at ${pct(PMI_AUTO_LTV)}. Tell me that value on your home loan page and I'll work out where you are. I don't guess it.`,
        actions: [EQUITY_PAGE],
        refs: {},
      };
    }
    const lines = pmiLines(data);
    if (data.pmiLetter) {
      lines.push("", data.pmiLetter);
      if (data.facts.pmiLetterSentOn) {
        lines.push(
          "",
          `You said you sent this on ${dayLabel(data.facts.pmiLetterSentOn, { year: true })}.`,
        );
      }
    }
    return {
      body: lines.join("\n"),
      actions:
        data.pmiLetter && !data.facts.pmiLetterSentOn
          ? [sentButton("pmi"), EQUITY_PAGE]
          : [EQUITY_PAGE],
      refs: data.pmiLetter && !data.facts.pmiLetterSentOn ? { homeRequest: "pmi" } : {},
    };
  }
  const lines = escrowLines(data);
  if (lines.length === 0) {
    return {
      body: "Tell me your yearly property tax and insurance bills on your home loan page and I'll check your escrow against them.",
      actions: [EQUITY_PAGE],
      refs: {},
    };
  }
  if (data.escrowLetter) {
    lines.push("", data.escrowLetter);
    if (data.facts.escrowRequestSentOn) {
      lines.push(
        "",
        `You said you sent this on ${dayLabel(data.facts.escrowRequestSentOn, { year: true })}.`,
      );
    }
  }
  const canSend = data.escrowLetter && !data.facts.escrowRequestSentOn;
  return {
    body: lines.join("\n"),
    actions: canSend ? [sentButton("escrow"), EQUITY_PAGE] : [EQUITY_PAGE],
    refs: canSend ? { homeRequest: "escrow" } : {},
  };
}
