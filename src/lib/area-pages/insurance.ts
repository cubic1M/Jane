import { POLICY_KINDS, RENEWAL_SOON_DAYS, type CoverEvent, type GapKey } from "@/config/insurance";
import type { RiskKind, SavingKind } from "@/config/insurance";
import type { TreeStatus } from "@/components/tree/interactive-tree";
import { shortMoney } from "@/lib/hub/view";
import { formatCents } from "@/lib/money";
import { buildAreaTree, firstSentences, type AreaItem, type AreaTree } from "./tree";
import { dayLabel } from "@/lib/day-label";

// The Insurance page as a tree (docs/design/area-pages.md): Insurance → its branches (cover
// needs, policies, missing cover, savings, renewals, life events, documents, card cover,
// household, questions, the health plan) → their items, each with a status, its key figure and
// a few words. Pure: the page loads the same records it always did and hands them here; the
// detail of each item (its actions and the long text behind "More") stays in the page.

export const INSURANCE_BRANCHES = {
  needs: "Your perfect coverage",
  missing: "Cover that looks missing",
  renewals: "Renewals going up",
  changes: "After life events",
  savings: "Pay less for the same cover",
  cards: "Cover through your cards",
  policies: "Your policies",
  documents: "Read from your documents",
  questions: "Questions about how you live",
  household: "Your household's cover",
  health: "Your health plan this year",
} as const;
export type InsuranceBranch = keyof typeof INSURANCE_BRANCHES;

// "needs:life", "policies:<id>": an item's id names its branch, so a link can open both.
export const itemId = (branch: InsuranceBranch, key: string) => `${branch}:${key}`;
export const branchOf = (id: string) => id.split(":")[0];

export const NEED_LABELS: Record<string, string> = {
  life: "Life cover",
  disability: "Disability cover",
  umbrella: "Umbrella",
  deductible: "Deductible",
  auto_liability: "Car injury liability",
  home_liability: "Home liability",
  renters_liability: "Renters liability",
  business_liability: "Business liability",
  professional_liability: "Professional liability",
  business_equipment: "Work equipment cover",
};

const GAP_LABELS: Record<GapKey, string> = {
  renters: "Renters insurance",
  home: "Home insurance",
  auto: "Car insurance",
  life: "Life cover",
  liability_only: "Liability cover",
  health: "Health cover",
  disability: "Disability cover",
  umbrella: "Umbrella cover",
  pet: "Pet cover",
  travel: "Travel cover",
  rideshare: "Cover while driving for pay",
  home_business: "Home business cover",
  valuables: "Cover for valuables",
  boat: "Boat cover",
  short_term_rental: "Cover for renting out",
  teen_driver: "A driver not on a policy",
  spouse_health: "Health cover for your partner",
  family_health_plan: "One health plan for everyone",
  business_liability: "Business liability",
  professional_liability: "Professional liability",
  car_business_use: "Car use for work",
  business_equipment: "Work equipment cover",
};

const SAVING_LABELS: Record<SavingKind, string> = {
  pay_in_full: "Pay the year up front",
  autopay: "Turn on autopay",
  paperless: "Go paperless",
  bundle: "Bundle with one insurer",
  telematics: "Join a safe-driver program",
  higher_deductible: "Raise the deductible",
};

const RISK_LABELS: Record<RiskKind, string> = {
  rideshare: "Driving for pay?",
  home_business: "A business at home?",
  new_dog: "A new pet?",
  valuable: "Something valuable?",
  boat: "A boat?",
  rental_out: "Renting your place out?",
};

const EVENT_LABELS: Record<CoverEvent, string> = {
  car_bought: "A new car",
  moving: "Your move",
  new_baby: "A new baby",
  married: "Getting married",
  new_job: "A new job",
};

const perYear = (cents: number) => `${shortMoney(cents)}/yr`;
const days = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export type InsuranceTreeInput = {
  asOf: string;
  needs: {
    kind: string;
    policyId: string | null;
    gapCents: number;
    haveCents: number;
    needCents: number;
    unit: "total" | "per_month";
    direction?: "raise" | "lower" | "ok";
    summary: string;
    opened: boolean;
  }[];
  policies: {
    id: string;
    kind: keyof typeof POLICY_KINDS;
    carrier: string;
    status: string;
    yearlyCents: number | null;
    renewsOn: string | null;
  }[];
  gaps: { key: GapKey; why: string; policyId: string | null }[];
  savings: { id: string; kind: SavingKind; yearlySavingCents: number; line: string }[];
  renewals: {
    id: string;
    carrier: string;
    status: string;
    currentAnnualCents: number;
    renewalAnnualCents: number;
    line: string;
  }[];
  changes: { ref: string; event: CoverEvent; intro: string; count: number }[];
  readings: { id: string; title: string }[];
  payingTwice: {
    findingId: string;
    merchant: string;
    card: string;
    annualSavingsCents: number | null;
  }[];
  cards: { accountId: string; card: string; benefits: number }[];
  household: { name: string; policies: number }[];
  risks: { id: string; kind: RiskKind; question: string }[];
  health: { metCents: number; deductibleCents: number } | null;
};

export function insuranceTree(input: InsuranceTreeInput): AreaTree {
  const item = (branch: InsuranceBranch, key: string, rest: Omit<AreaItem, "id">): AreaItem => ({
    id: itemId(branch, key),
    ...rest,
    summary: firstSentences(rest.summary),
  });

  const needs = input.needs.map((n) => {
    const short = n.direction ? n.direction !== "ok" : n.gapCents > 0;
    const status: TreeStatus = !short ? "good" : n.opened ? "act" : "look";
    const money = (c: number) => (n.unit === "per_month" ? `${shortMoney(c)}/mo` : shortMoney(c));
    return item("needs", `${n.kind}${n.policyId ? `-${n.policyId}` : ""}`, {
      label: NEED_LABELS[n.kind] ?? n.kind,
      status,
      figure: !short ? "Covered" : n.gapCents > 0 ? `${money(n.gapCents)} short` : "Check",
      cents: n.gapCents,
      // The working (n.summary and its lines) is behind "More".
      summary: `You need ${money(n.needCents)}; you have ${money(n.haveCents)}.`,
    });
  });

  const gapPolicies = new Set(input.gaps.map((g) => g.policyId).filter(Boolean));
  const policies = input.policies.map((p) => {
    const soon = p.renewsOn !== null && days(input.asOf, p.renewsOn) <= RENEWAL_SOON_DAYS;
    const status: TreeStatus = gapPolicies.has(p.id)
      ? "act"
      : p.status !== "active" || soon
        ? "look"
        : "good";
    return item("policies", p.id, {
      label: `${p.carrier} ${POLICY_KINDS[p.kind].toLowerCase()}`,
      status,
      figure: p.yearlyCents !== null ? perYear(p.yearlyCents) : undefined,
      summary:
        p.status !== "active"
          ? "Found from your payments; confirm it to count it."
          : p.renewsOn
            ? `Renews ${dayLabel(p.renewsOn)}.`
            : "Active.",
    });
  });

  const missing = input.gaps.map((g) =>
    item("missing", g.key + (g.policyId ? `-${g.policyId}` : ""), {
      label: GAP_LABELS[g.key],
      status: "act",
      figure: "Missing",
      summary: g.why,
    }),
  );

  const savings = input.savings.map((s) =>
    item("savings", s.id, {
      label: SAVING_LABELS[s.kind],
      status: "look",
      figure: perYear(s.yearlySavingCents),
      cents: s.yearlySavingCents,
      summary: `${s.line}.`,
    }),
  );

  const renewals = input.renewals.map((r) => {
    const up = r.renewalAnnualCents - r.currentAnnualCents;
    return item("renewals", r.id, {
      label: `${r.carrier} renewal`,
      status: r.status === "asked" ? "act" : "good",
      figure: up > 0 ? `+${perYear(up)}` : perYear(r.renewalAnnualCents),
      cents: Math.max(0, up),
      summary: r.line,
    });
  });

  const changes = input.changes.map((c) =>
    item("changes", c.ref, {
      label: EVENT_LABELS[c.event],
      status: "act",
      figure: `${c.count} ${c.count === 1 ? "change" : "changes"}`,
      summary: c.intro,
    }),
  );

  const documents = input.readings.map((r) =>
    item("documents", r.id, {
      label: r.title.split(/\s+/).slice(0, 6).join(" "),
      status: "look",
      figure: "To confirm",
      summary: "Nothing here is on your insurance until you confirm it.",
    }),
  );

  const cards = [
    ...input.payingTwice.map((d) =>
      item("cards", `twice-${d.findingId}`, {
        label: `Paying twice: ${d.merchant}`.split(/\s+/).slice(0, 6).join(" "),
        status: "act",
        figure: d.annualSavingsCents ? perYear(d.annualSavingsCents) : undefined,
        cents: d.annualSavingsCents ?? 0,
        summary: `You pay ${d.merchant}${d.annualSavingsCents ? ` ${formatCents(d.annualSavingsCents)} a year` : ""} for cover your ${d.card} already gives you.`,
      }),
    ),
    ...input.cards.map((c) =>
      item("cards", c.accountId, {
        label: c.card.split(/\s+/).slice(0, 6).join(" "),
        status: "good",
        figure: `${c.benefits} ${c.benefits === 1 ? "benefit" : "benefits"}`,
        summary: "Cover your card gives you, from its benefit guide.",
      }),
    ),
  ];

  const household = input.household.map((h) =>
    item("household", h.name, {
      label: h.name,
      status: h.policies === 0 ? "look" : "good",
      figure:
        h.policies === 0 ? "None" : `${h.policies} ${h.policies === 1 ? "policy" : "policies"}`,
      summary: h.policies === 0 ? "No policy on file covers them." : "Who covers them is below.",
    }),
  );

  // Adding someone, or choosing what to share, is a step of its own in the household branch.
  household.push(
    item("household", "add", {
      label: "Add someone or share",
      summary: "Add the people in your household, and choose which policies they can see.",
    }),
  );

  const questions = input.risks.map((r) =>
    item("questions", r.id, {
      label: RISK_LABELS[r.kind],
      status: "look",
      figure: "Yes or no",
      summary: r.question,
    }),
  );

  const health = input.health
    ? [
        item("health", "deductible", {
          label: "Deductible this year",
          status: "good",
          figure: `${shortMoney(input.health.metCents)} of ${shortMoney(input.health.deductibleCents)}`,
          summary: "How much of this year's deductible you've met.",
        }),
      ]
    : [];

  const branches: { id: InsuranceBranch; items: AreaItem[] }[] = [
    { id: "needs", items: needs },
    { id: "missing", items: missing },
    { id: "renewals", items: renewals },
    { id: "changes", items: changes },
    { id: "savings", items: savings },
    { id: "cards", items: cards },
    { id: "policies", items: policies },
    { id: "documents", items: documents },
    { id: "questions", items: questions },
    { id: "household", items: household },
    { id: "health", items: health },
  ];
  return buildAreaTree({
    key: "insurance",
    label: "Insurance",
    sub: ({ urgent, look }) =>
      urgent > 0
        ? `${urgent} urgent · ${look} to look at`
        : look > 0
          ? `${look} to look at`
          : "All good",
    branches: branches.map((b) => ({ id: b.id, label: INSURANCE_BRANCHES[b.id], items: b.items })),
  });
}
