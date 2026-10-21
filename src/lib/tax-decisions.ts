import {
  ADVICE_DECISIONS,
  SAVING_DECISIONS,
  type DecisionTopic,
  ROTH_UNTIL_RATE,
  TRADITIONAL_FROM_RATE,
} from "@/config/tax-decisions";
import { CONTRIBUTION_LIMITS, STANDARD_DEDUCTION } from "@/config/tax-rates";
import type { PrismaClient } from "@/generated/prisma/client";
import { debtFirst } from "@/lib/debt-first";
import { adviceMode } from "@/lib/advice-mode";
import { db as defaultClient } from "@/lib/db";
import { loadGiving } from "@/lib/giving";
import { loadHomeTaxes } from "@/lib/home-taxes";
import { loadInvestmentTaxes } from "@/lib/investment-taxes";
import { loadMultiYear } from "@/lib/multi-year";
import { loadPropertyTax } from "@/lib/property-tax";
import { loadSelfEmployed } from "@/lib/self-employed";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { loadTaxSavings } from "@/lib/tax-savings";
import { checkFrom } from "@/lib/tax-withholding";
import { formatCents } from "@/lib/money";
import { dayLabel } from "@/lib/day-label";
import { roundDollars } from "@/planning/tax-estimate-copy";

// Direct answers to tax questions (taxes in the chat): three sentences or fewer, from the
// person's own numbers, as a decision (what to do) or a fact (what it is). Every answer is
// built from the same loaders as the rest of taxes, so it agrees with the page. Recommendations
// are demo advice: they carry the label in advice mode and, for a real account, say the fact
// without telling anyone what to do.

type Options = { client?: PrismaClient; now?: Date };

export type Decision = {
  topic: DecisionTopic;
  // Three sentences or fewer.
  text: string;
  // A recommendation: shown with the demo advice label in advice mode.
  advice: boolean;
  // Where the numbers are, for a button.
  href: string;
  // The figures in the answer, in cents, so a test (or Claude) can check them.
  figures: number[];
};

const pct = (rate: number) => `${Math.round(rate * 100)}%`;

export async function decideTax(
  userId: string,
  topic: DecisionTopic,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<Decision> {
  const [est, advice] = await Promise.all([
    loadTaxEstimate(userId, { client, now }),
    adviceMode(userId, { client }),
  ]);
  const e = est.estimate;
  const href = "/taxes";
  const made = (text: string, figures: number[] = [], to = href): Decision => ({
    topic,
    text,
    advice: advice && ADVICE_DECISIONS.includes(topic),
    href: to,
    figures,
  });
  // A real account gets the fact and no recommendation (src/config/advice.ts).
  const noAdvice = (fact: string, figures: number[] = [], to = href) =>
    made(`${fact} I can only say what the numbers are, not what to do.`, figures, to);
  const recommend = (fact: string, figures: number[] = [], to = href) =>
    advice ? null : noAdvice(fact, figures, to);

  // Someone overdrawn or paying a high rate on debt is told to clear that first, before any
  // new contribution (the tax saving is smaller than the interest).
  if (advice && SAVING_DECISIONS.includes(topic)) {
    const stress = await debtFirst(userId, client);
    if (stress)
      return made(
        `Not yet. ${stress} Pay that down first: it costs you more than the tax saving would, and a new paycheck deferral would leave you shorter each month.`,
        [],
        "/debt",
      );
  }

  switch (topic) {
    case "itemize": {
      const d = e.deduction;
      const itemized = d.itemizedCents;
      const standard = d.standardCents;
      const diff = Math.abs(itemized - standard);
      const worth = Math.round(diff * e.marginalRate);
      const fact = `Your itemized deductions come to ${formatCents(itemized)} and the standard deduction is ${formatCents(standard)}.`;
      const gate = recommend(fact, [itemized, standard]);
      if (gate) return gate;
      return itemized > standard
        ? made(
            `Itemize. ${fact} Itemizing lowers your federal tax by about ${roundDollars(worth)}.`,
            [itemized, standard, worth],
            "/taxes/home",
          )
        : made(
            `Take the standard deduction. ${fact} Itemizing would cost you about ${roundDollars(worth)} more.`,
            [itemized, standard, worth],
          );
    }
    case "roth_conversion": {
      const years = await loadMultiYear(userId, { client, now, loaded: { estimate: est, advice } });
      const rate = e.marginalRate;
      const move = years.moves.find((m) => m.kind === "roth");
      const gate = recommend(`You're in the ${pct(rate)} bracket now.`, [], "/taxes/years");
      if (gate) return gate;
      return move
        ? made(
            `Yes, consider it: ${move.title.toLowerCase()}. It would save about ${roundDollars(move.effectCents)} in tax over the years. A tax professional should confirm it.`,
            [move.effectCents],
            "/taxes/years",
          )
        : made(
            `Probably not this year. You're in the ${pct(rate)} bracket now and I don't see a year ahead with room in a lower one, so converting would cost more than it saves. The best time is a low-income year, like your first in retirement.`,
            [],
            "/taxes/years",
          );
    }
    case "withholding": {
      const check = checkFrom(est);
      const gate = recommend(
        check.status === "unknown"
          ? "I can't see enough of your pay to check."
          : `You're on course for ${e.refundCents >= 0 ? `a refund of ${roundDollars(e.refundCents)}` : `owing ${roundDollars(-e.refundCents)}`}.`,
        [e.refundCents],
      );
      if (gate) return gate;
      if (check.status === "unknown")
        return made(
          "I can't tell yet: I need to see your pay stubs to check your withholding.",
          [],
          "/taxes#withholding",
        );
      if (check.status === "on_track")
        return made(
          `No, it's about right. You're on course for ${e.refundCents >= 0 ? `a refund of ${roundDollars(e.refundCents)}` : `owing ${roundDollars(-e.refundCents)}`}.`,
          [e.refundCents],
          "/taxes#withholding",
        );
      const change = check.thisYear ?? check.fromJanuary;
      const per = Math.abs(change.perPaycheckCents);
      return check.status === "big_refund"
        ? made(
            `Yes, lower it. You're on course for a refund of ${roundDollars(e.refundCents)}, your own money held until spring. A new W-4 would put about ${roundDollars(per)} more in each paycheck.`,
            [e.refundCents, per],
            "/taxes#withholding",
          )
        : made(
            `Yes, raise it. You're on course to owe about ${roundDollars(-e.refundCents)} in April. A new W-4 would take about ${roundDollars(per)} more from each paycheck to cover it.`,
            [-e.refundCents, per],
            "/taxes#withholding",
          );
    }
    case "estimated": {
      const se = await loadSelfEmployed(userId, { client, now, loaded: { estimate: est, advice } });
      const next = se.federal.payments[0];
      if (se.federal.needed && next) {
        return made(
          `Yes. After withholding you'd owe about ${roundDollars(se.federal.owedCents)}, so pay about ${roundDollars(next.cents)} by ${dayLabel(next.date, { year: true })} and the rest on the later dates.`,
          [se.federal.owedCents, next.cents],
          "/taxes/self-employed",
        );
      }
      return made(
        se.active
          ? `No. What you'd owe after withholding is under $1,000, so there's no penalty for skipping the quarterly payments.`
          : `No. Your employer's withholding covers your tax, and you're on course for ${e.refundCents >= 0 ? `a refund of ${roundDollars(e.refundCents)}` : `owing ${roundDollars(-e.refundCents)}`}.`,
        [e.refundCents],
        "/taxes/self-employed",
      );
    }
    case "k401": {
      const s = (
        await loadTaxSavings(userId, { client, now, loaded: { estimate: est, advice } })
      ).savings.find((x) => x.key === "retirement");
      const limit = CONTRIBUTION_LIMITS.workplace;
      const gate = recommend(`The 2026 limit for a 401(k) is ${formatCents(limit)}.`, [limit]);
      if (gate) return gate;
      return s
        ? made(
            `Yes, if you can spare it. ${s.title}. By my estimate that is about ${roundDollars(s.estimateCents)} less tax this year.`,
            [s.estimateCents, limit],
          )
        : made(
            `It would lower your tax by about ${pct(e.marginalRate)} of what you put in, up to the ${formatCents(limit)} limit. I can't see how much you've put in this year, so I can't size it.`,
            [limit],
          );
    }
    case "ira": {
      const rate = e.marginalRate;
      const limit = CONTRIBUTION_LIMITS.ira;
      const gate = recommend(
        `You're in the ${pct(rate)} bracket, and the IRA limit is ${formatCents(limit)}.`,
        [limit],
      );
      if (gate) return gate;
      const pick =
        rate >= TRADITIONAL_FROM_RATE
          ? `A traditional IRA: at ${pct(rate)}, the deduction now (about ${roundDollars(Math.round(limit * rate))} on a full ${formatCents(limit)}) is worth more than tax-free growth later.`
          : rate <= ROTH_UNTIL_RATE
            ? `A Roth IRA: at ${pct(rate)}, paying tax now is cheap and the growth comes out tax-free.`
            : `Either works at ${pct(rate)}: a Roth if you expect a similar or higher bracket later, a traditional IRA if you expect a lower one.`;
      return made(`${pick} Income limits can block a direct Roth IRA at higher incomes.`, [limit]);
    }
    case "hsa": {
      const limit = CONTRIBUTION_LIMITS.hsaSelf;
      const gate = recommend(`The 2026 HSA limit is ${formatCents(limit)} for one person.`, [
        limit,
      ]);
      if (gate) return gate;
      return made(
        `Only if your health plan is high-deductible, which I can't see from your accounts. If it is, up to ${formatCents(limit)} a year goes in tax-free and saves about ${roundDollars(Math.round(limit * e.marginalRate))} at your ${pct(e.marginalRate)} bracket.`,
        [limit],
      );
    }
    case "property": {
      const p = await loadPropertyTax(userId, { client, now, loaded: { estimate: est, advice } });
      if (!p.gap)
        return made(
          "I can't say yet: I need your home's assessed value and what it would sell for.",
          [],
          "/taxes/property",
        );
      const gate = recommend(
        `Your home is assessed ${Math.round(p.gap.gapRate * 100)}% ${p.gap.gapCents > 0 ? "over" : "under"} its market value.`,
        [p.gap.assessedCents, p.gap.marketCents],
        "/taxes/property",
      );
      if (gate) return gate;
      return p.suggested
        ? made(
            `Yes. You're assessed at ${roundDollars(p.gap.assessedCents)} against a market value of ${roundDollars(p.gap.marketCents)}, and an appeal could save about ${roundDollars(p.gap.savingCents)} a year. ${p.window.text}`,
            [p.gap.assessedCents, p.gap.marketCents, p.gap.savingCents],
            "/taxes/property",
          )
        : made(
            `Probably not. The gap is ${Math.round(p.gap.gapRate * 100)}%, which is ${p.window.status === "closed" ? "over the line but the window has closed" : "too small to be worth the effort"}.`,
            [p.gap.assessedCents, p.gap.marketCents],
            "/taxes/property",
          );
    }
    case "harvest": {
      const inv = await loadInvestmentTaxes(userId, e.year, { client, now });
      const gate = recommend(
        "Harvesting a loss means selling a holding below what you paid.",
        [],
        "/taxes#investments",
      );
      if (gate) return gate;
      const top = inv.harvest[0];
      return top
        ? made(
            `Yes, ${inv.harvest.length === 1 ? "one holding is" : `${inv.harvest.length} holdings are`} below cost. Selling ${top.holding.name} would realise a loss of ${roundDollars(top.lossCents)}, which lowers your tax by about ${roundDollars(Math.round(Math.min(top.lossCents, 300_000) * e.marginalRate))}. Don't buy the same thing back for 30 days.`,
            [top.lossCents],
            "/taxes#investments",
          )
        : made(
            "No. I don't see a holding in a taxable account that's below what you paid, so there's no loss to harvest.",
            [],
            "/taxes#investments",
          );
    }
    case "donate_stock": {
      const g = await loadGiving(userId, { client, now, loaded: { estimate: est, advice } });
      const gate = recommend(
        `You've given ${formatCents(g.totalCents)} this year.`,
        [g.totalCents],
        "/taxes#giving",
      );
      if (gate) return gate;
      const shares = g.options.find((o) => o.key === "shares");
      return shares
        ? made(
            `Yes. Giving shares you've held over a year, instead of cash, saves about ${roundDollars(shares.savesCents)} because you skip the tax on their gain.`,
            [shares.savesCents],
            "/taxes#giving",
          )
        : made(
            `Not at your level of giving. You've given ${formatCents(g.totalCents)} this year, and the standard deduction is bigger than your itemized total, so the gift wouldn't change your tax.`,
            [g.totalCents],
            "/taxes#giving",
          );
    }
    case "home_office": {
      const se = await loadSelfEmployed(userId, { client, now, loaded: { estimate: est, advice } });
      const gate = recommend(
        "The home office deduction is for people who work for themselves.",
        [],
        "/taxes/self-employed",
      );
      if (gate) return gate;
      return se.active
        ? made(
            `Yes, if you use a room only for work. It's $5 a square foot up to 300, so ${se.homeOffice.sqft ? `your ${se.homeOffice.sqft} square feet is ${formatCents(se.homeOffice.deductionCents)}` : "tell me the size and I'll work it out"}.`,
            [se.homeOffice.deductionCents],
            "/taxes/self-employed",
          )
        : made(
            "No. If you're an employee you can't deduct a home office; only the self-employed can. I don't see freelance income in your accounts.",
            [],
            "/taxes/self-employed",
          );
    }
    case "owe":
    case "refund": {
      const fed = e.refundCents;
      const state = e.state;
      const stateLine =
        state && state.kind !== "none"
          ? ` ${state.code}: ${state.refundCents >= 0 ? `a refund of ${roundDollars(state.refundCents)}` : `owing ${roundDollars(-state.refundCents)}`}.`
          : "";
      return made(
        `Federal: ${fed >= 0 ? `you're on course for a refund of ${roundDollars(fed)}` : `you're on course to owe ${roundDollars(-fed)}`}.${stateLine} That's an estimate from your income so far, projected to the end of the year.`,
        [fed, state?.refundCents ?? 0],
      );
    }
    case "refund_why": {
      const tax = e.totalTaxCents;
      const paid = e.paidCents;
      return made(
        `Your federal tax comes to ${roundDollars(tax)} and about ${roundDollars(paid)} is being withheld, so the ${e.refundCents >= 0 ? "refund" : "bill"} is ${roundDollars(Math.abs(e.refundCents))}. The more that comes out of each paycheck beyond your tax, the bigger the refund; deductions and credits you can claim shrink the tax itself.`,
        [tax, paid, e.refundCents],
        "/taxes#withholding",
      );
    }
    case "effective_rate": {
      const rate = e.totalIncomeCents > 0 ? e.totalTaxCents / e.totalIncomeCents : 0;
      return made(
        `Your effective federal rate is about ${(rate * 100).toFixed(1)}%: ${roundDollars(e.totalTaxCents)} of tax on ${roundDollars(e.totalIncomeCents)} of income. Your top rate is ${pct(e.marginalRate)}, which applies only to your last dollars.`,
        [e.totalTaxCents, e.totalIncomeCents],
      );
    }
    case "paid": {
      const so = est.pay.soFar.federalWithheldCents;
      return made(
        `Your employer has withheld about ${roundDollars(so)} of federal tax from your pay so far this year. At this pace it will be about ${roundDollars(e.paidCents)} by the end, against ${roundDollars(e.totalTaxCents)} of tax.`,
        [so, e.paidCents, e.totalTaxCents],
      );
    }
    case "deductions": {
      const d = e.deduction;
      const parts = [
        ["mortgage interest", d.itemized.mortgageInterestCents],
        ["state and local taxes", d.itemized.stateLocalTaxCents],
        ["charity", d.itemized.charityCents],
        ["medical costs over the floor", d.itemized.medicalCents],
      ].filter(([, c]) => (c as number) > 0) as [string, number][];
      const list = parts.map(([n, c]) => `${n} ${roundDollars(c)}`).join(", ");
      return made(
        `You can deduct the standard ${roundDollars(d.standardCents)}, or itemize${list ? ` (${list}, ${roundDollars(d.itemizedCents)} in all)` : " if your costs add up to more"}. ${d.kind === "itemized" ? "Itemizing is the bigger one for you." : "The standard deduction is the bigger one for you."}`,
        [d.standardCents, d.itemizedCents],
      );
    }
    case "setaside": {
      const se = await loadSelfEmployed(userId, { client, now, loaded: { estimate: est, advice } });
      if (!se.active) {
        const per = est.paychecks.withheldPerPaycheckCents ?? 0;
        return made(
          `Nothing: your employer already sets it aside${per > 0 ? ` (about ${roundDollars(per)} a paycheck)` : ""}. Only income with no tax withheld, like freelance pay, needs a share put aside.`,
          [per],
        );
      }
      return made(
        `About ${Math.round(se.setAsideRate * 100)}% of each payment. That's the tax your freelance income adds, as a share of what comes in.`,
        [],
        "/taxes/self-employed",
      );
    }
    case "est_due": {
      const se = await loadSelfEmployed(userId, { client, now, loaded: { estimate: est, advice } });
      const next = se.federal.payments[0];
      return next && se.federal.needed
        ? made(
            `Your next estimated payment, about ${roundDollars(next.cents)}, is due ${dayLabel(next.date, { year: true })}.`,
            [next.cents],
            "/taxes/self-employed",
          )
        : made(
            `The dates are April 15, June 15, September 15 and January 15, but you don't need to pay: ${se.active ? "what you'd owe is under $1,000" : "your employer's withholding covers you"}.`,
            [],
            "/taxes/self-employed",
          );
    }
    case "must_file": {
      const std = STANDARD_DEDUCTION[e.filingStatus];
      const income = e.totalIncomeCents;
      return made(
        income > std
          ? `Yes. Your income of ${roundDollars(income)} is over the ${formatCents(std)} standard deduction. Even under it you'd file to get back what was withheld.`
          : `Probably not: your income of ${roundDollars(income)} is under the ${formatCents(std)} standard deduction. File anyway if tax was withheld, to get it back.`,
        [income, std],
      );
    }
    case "k401_limit": {
      const limit = CONTRIBUTION_LIMITS.workplace;
      const put = est.pay.projected.retirementCents;
      return made(
        `The 2026 limit for a 401(k) is ${formatCents(limit)} (more from age 50). ${put > 0 ? `Your pay stubs show a 401(k) deferral that comes to about ${roundDollars(put)} this year (no retirement account is linked, so I can't see the balance), which leaves ${roundDollars(Math.max(0, limit - put))} of room.` : "I don't see a 401(k) deferral on your pay stubs, so all of it is room."}`,
        [limit, put],
      );
    }
    case "mortgage_interest": {
      const h = await loadHomeTaxes(userId, { client, now, loaded: { estimate: est } });
      const m = h.mortgageInterest;
      return m
        ? made(
            `All ${roundDollars(m.cents)} of your mortgage interest can be deducted, but only if you itemize; the limit applies to loans over $750,000. ${e.deduction.kind === "itemized" ? "You're itemizing, so it counts." : "You're taking the standard deduction, so it doesn't change your tax."}`,
            [m.cents],
            "/taxes/home",
          )
        : made(
            "I don't see a mortgage in your accounts, so there's no mortgage interest to deduct.",
            [],
            "/taxes/home",
          );
    }
  }
}
