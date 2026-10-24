import { nextRenewal, yearlyPremium } from "@/lib/insurance/policies";
import { loadInsurance } from "@/lib/insurance/profile";
import { listReadings } from "@/lib/insurance/readings";
import { listCoverChanges } from "@/lib/insurance/cover-changes";
import { listNegotiations } from "@/lib/insurance/negotiate";
import { listSavings, refreshSavings } from "@/lib/insurance/savings";
import { listRisks, refreshRisks } from "@/lib/insurance/risks";
import { loadFamily } from "@/lib/insurance/family";
import { loadHealthYear } from "@/lib/insurance/health-year";
import { partnerFor } from "@/lib/insurance/partner";
import { cardCover } from "@/lib/insurance/card-cover";
import { riskQuestion } from "@/lib/jane-agent/insurance/risk-words";
import { savingLine } from "@/lib/jane-agent/insurance/saving-words";
import { askCallBody, callResultBody } from "@/lib/jane-agent/insurance/done-by-jane-words";
import { coverBody, coverEventRef } from "@/lib/jane-agent/insurance/cover-words";
import { loadCoverage, needKey } from "@/lib/area-pages/insurance-coverage";
import { insuranceTree } from "@/lib/area-pages/insurance";

// Everything the Insurance tree is built from (docs/design/area-pages.md), loaded once for the
// Insurance page and for the home tree, so both show the same statuses. The page also asks it
// to look again for savings and questions (`refresh`); the home tree only reads.

export async function loadInsuranceArea(
  userId: string,
  {
    now = new Date(),
    refresh = false,
    need = "",
    policyId = "",
  }: { now?: Date; refresh?: boolean; need?: string; policyId?: string } = {},
) {
  const asOf = now.toISOString().slice(0, 10);
  const { policies, household, gaps, advice } = await loadInsurance(userId, { now });
  // Read after loadInsurance, which reads any policy document not read yet.
  const [readings, cards, prepared, partner, negotiations] = await Promise.all([
    listReadings(userId, { status: "waiting" }),
    cardCover(userId),
    listCoverChanges(userId, { status: "prepared" }),
    partnerFor(userId),
    listNegotiations(userId),
  ]);
  // Spec step 196: looked at again whenever the page opens.
  const savings = refresh
    ? await refreshSavings(userId)
    : await listSavings(userId, { status: "offered" });
  // Spec step 198: the household's cover, what's shared with them and who is covered.
  const family = await loadFamily(userId);
  const healthYear = await loadHealthYear(userId);
  // Spec step 197: the questions about how they live, read from their payments.
  if (refresh) await refreshRisks(userId);
  const risks = await listRisks(userId, { status: "asked" });
  const policyById = (id: string) => policies.find((p) => p.id === id);
  const renewals = negotiations.filter((n) => n.status !== "declined").slice(-3);
  // Spec step 154: one group per life event.
  const changeGroups = [
    ...prepared
      .reduce((groups, c) => {
        const ref = coverEventRef(c.event, c.eventKey);
        return groups.set(ref, [...(groups.get(ref) ?? []), c]);
      }, new Map<string, typeof prepared>())
      .entries(),
  ];
  const payingTwice = cards.duplicates.filter((d) => d.status === "new" || d.status === "shown");
  const coverage = await loadCoverage(userId, { advice, selected: need, policyId });

  // The tree: the same records, a few words and a figure each.
  const area = insuranceTree({
    asOf,
    needs: coverage.needs.map((n) => ({ ...n, opened: coverage.opened.has(needKey(n)) })),
    policies: policies.map((p) => ({
      id: p.id,
      kind: p.kind,
      carrier: p.carrier,
      status: p.status,
      yearlyCents: yearlyPremium(p),
      renewsOn: nextRenewal(p, asOf),
    })),
    gaps,
    savings: savings.map((s) => ({ ...s, line: savingLine(s, policyById(s.policyId)) })),
    renewals: renewals.map((n) => ({
      ...n,
      carrier: policyById(n.policyId)?.carrier ?? "Your insurer",
      line: (n.status === "asked"
        ? askCallBody(n, policyById(n.policyId))
        : callResultBody(n, policyById(n.policyId))
      ).split("\n")[0],
    })),
    changes: changeGroups.map(([ref, changes]) => ({
      ref,
      event: changes[0].event,
      intro: coverBody(changes[0].event, changes, policies, partner !== null).split("\n")[0],
      count: changes.length,
    })),
    readings,
    payingTwice,
    cards: cards.cards.map((c) => ({
      accountId: c.accountId,
      card: c.card,
      benefits: c.benefits.length,
    })),
    household: family.rows.map((r) => ({ name: r.name, policies: r.policies.length })),
    risks: risks.map((r) => ({ id: r.id, kind: r.kind, question: riskQuestion(r) })),
    health: healthYear
      ? {
          metCents: healthYear.progress.deductibleMetCents,
          deductibleCents: healthYear.plan.deductibleCents,
        }
      : null,
  });

  return {
    asOf,
    policies,
    household,
    gaps,
    advice,
    readings,
    cards,
    partner,
    savings,
    family,
    healthYear,
    risks,
    renewals,
    changeGroups,
    payingTwice,
    coverage,
    policyById,
    area,
  };
}
