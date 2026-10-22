import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { EMPLOYER_STOCK_LIMIT } from "@/config/company-stock";
import { AUTO_PAUSED_NUDGE_DAYS, PROFILE_QUESTIONS } from "@/config/investing";
import { portfolioNote } from "@/insights/portfolio-note";
import { bucketLine, byHerselfLine } from "../investments/goals-copy";
import { formatCents } from "@/lib/money";
import { nextQuestion, profileSummary } from "@/planning/investor-profile";
import { equivalentLine, switchSummary } from "../investments/fees-copy";
import { planSummary, rebalanceButton, SIMULATED_WORDS } from "../investments/rebalance-copy";
import {
  AUTO_LINK,
  AUTO_PROMISE,
  pauseButton,
  resumeButton,
  runLine,
  startButtons,
} from "../investments/auto-copy";
import { matchLine, projectionLine } from "../investments/retirement-copy";
import { asking, PROFILE_INTRO } from "../investments/profile-question";
import {
  COMPANY_LINK,
  concentrationLine,
  planLine,
  sellButton,
  sellDue,
  SELL_WORDS,
} from "../investments/company-copy";
import type { Candidate } from "../types";
import { detectDrop } from "@/planning/steady-hand";
import { STEADY_LINK, steadyMessage } from "../investments/steady-copy";
import { MATCH_MIN_MISSED_CENTS, ROOM_MIN_CENTS } from "@/config/retirement-accounts";
import {
  iraButton,
  limitsLine,
  matchButton,
  raMatchLine,
  RA_LINK,
  rothLine,
} from "../investments/retirement-accounts-copy";
import { OLD_PLAN_MIN_SAVING_CENTS } from "@/config/old-accounts";
import {
  foundLine,
  OLD_LINK,
  questionButtons,
  questionLine,
  rollButton,
} from "../investments/old-accounts-copy";
import {
  drawLine,
  paycheckLine,
  RI_LINK,
  rmdLine,
  ssLine,
} from "../investments/retirement-income-copy";
import { FAMILY_LINK, giftOffer, rothOffer } from "../investments/family-copy";
import { PROPERTY_LINK, paydownLine, rentalLine } from "../investments/property-copy";
import { MIN_YEARLY_COST_CENTS } from "@/config/costly-products";
import {
  advisoryLine,
  COSTLY_LINK,
  premiumQuestion,
  productLine,
} from "../investments/costly-copy";
import { REVIEW_LINK, reviewFor } from "../investments/review-copy";
import { MIN_SAVING_CENTS } from "@/config/location";
import { freeButton, LOCATION_LINK, locationLine } from "../investments/location-copy";
import { MENU_MIN_SAVING_CENTS } from "@/config/plan-menu";
import {
  changeButton,
  confirmButtons,
  MENU_LINK,
  proposedLine,
  savingLine,
} from "../investments/menu-copy";
import { MIN_GAIN_CENTS } from "@/config/short-term";
import { candidateLine, ladderButton, SHORT_LINK } from "../investments/short-term-copy";
import {
  planBody,
  suddenQuestionButtons,
  suddenQuestionLine,
  stageButton,
  SUDDEN_LINK,
} from "../investments/sudden-copy";
import { valuesPlanLine, valuesButton, VALUES_LINK } from "../investments/values-copy";
import { attentionLine, FILE_LINK } from "../investments/family-file-copy";
import { AUTO_LOG_LINK, summaryBody } from "../investments/automatic-copy";
import { CASH_MIN_GAIN_CENTS } from "@/config/cash";
import { CASH_LINK, cashLine, moveButtons } from "../investments/cash-copy";
import {
  CRYPTO_LINK,
  feeFlag,
  NEVER_TRADES,
  shareFlag,
  sizeLine,
} from "../investments/crypto-copy";
import { learnLink } from "../learn";
import { snoozeButton, type MessageSource } from "./source";

// Investments in the chat (spec step 128 on). What Jane does by herself, at every autopilot
// level:
// - Step 128: keeps the holdings up to date on each sync, and says once that she can see
//   them. Nothing to approve.
// - Step 129: in demo advice mode, asks the four investor-profile questions once she can see
//   holdings, and again a year after they were answered. She never answers or changes them
//   herself; nothing uses the profile until all four are in.
// - Step 130: in demo advice mode, finds what investing costs and a lower-cost equivalent
//   for each costly fund, and says so once (again if the funds change). Switching moves
//   money, so it always waits for the person's tap (step 133).
// - Step 131: in demo advice mode, once the profile is complete, reviews the mix against
//   its target and says what to change and why (again when that changes).
//   Step 133: with the orders that move to the target mix ready, so one tap places them
//   (with the simulated brokerage until a real one is connected). Trading moves money, so
//   it always waits for that tap, at every autopilot level.
// - Step 134: in demo advice mode, once the profile is complete, offers once to invest
//   automatically every payday (starting it is the person's tap); then on each payday
//   invests by herself, at every autopilot level, says what she invested, and pauses that
//   payday by herself when safe to spend is low, saying why.
// - Step 135: in demo advice mode, once the profile is complete, says once which account to
//   fill first and where each holding is best kept (again when that changes). Moving money
//   between accounts is the person's step.
// - Step 157: in demo advice mode, gives each goal a mix by when it's needed (cash under 3
//   years) and says so once per set of goals; at "Handle the safe stuff" and above, splits
//   automatic investing's new money by goal by herself.
// - Step 158: in demo advice mode, when the tax profile has children and there's no college
//   plan, offers once to plan for college; starting one is the person's tap, then the goal
//   is funded by step 157's buckets and automatic investing.
// - Step 159: saves medical charges to the HSA receipts vault by herself, says so once per
//   batch, and in demo advice mode offers to invest the HSA's cash beyond its cushion (a
//   tap), or a demo HSA when there's none.
// - Step 137: a monthly note on how the investments stand (no predictions), with at most
//   one decision (the orders when the mix has drifted); a nudge when automatic investing
//   has been paused for a month; and what she does by herself at each autopilot level
//   (src/config/investing.ts INVESTMENT_AUTOPILOT).
// - Step 132: in demo advice mode, once the profile is complete, checks the retirement
//   projection and the employer match, and says so when the person is behind or missing
//   match money (again when that changes). Raising a contribution is done at the
//   employer's plan, so Jane says how and checks the next contributions herself.

const list = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

export const investmentsSource: MessageSource = {
  key: "investments",
  gather(snapshot) {
    const inv = snapshot.investments;
    if (!inv || inv.holdingCount === 0) return [];
    const out: Candidate[] = [
      {
        kind: "heads_up",
        body: `I can see what's in your investment accounts now: ${inv.holdingCount} ${inv.holdingCount === 1 ? "holding" : "holdings"} worth ${formatCents(inv.totalCents)} in ${list(inv.accounts.map((a) => a.name))}. Every number shows where it came from, and I'll keep it up to date.`,
        refs: {},
        actions: [
          { id: "open", label: "See what you own", kind: "link", href: "/investments" },
          snoozeButton(),
        ],
        dedupeKey: "holdings",
        priority: MESSAGE_PRIORITY.investments,
      },
    ];
    if (inv.advice) {
      const next = nextQuestion(inv.profile);
      const summary = profileSummary(inv.profile, snapshot.asOf);
      // A year on, all four again (a new key each year).
      const again = summary.complete && summary.stale;
      const question = next ?? (again ? PROFILE_QUESTIONS[0] : null);
      if (question) {
        const ask = asking(question, again);
        out.push({
          kind: "decision",
          body: again
            ? "It's been a year since you told me what your investments are for. Has anything changed? Tap your answers again; the rest stays as it was."
            : PROFILE_INTRO,
          refs: ask.refs,
          actions: [...ask.actions, snoozeButton()],
          dedupeKey: again ? `profile:${snapshot.asOf.slice(0, 4)}` : "profile",
          priority: MESSAGE_PRIORITY.investment_profile,
        });
      }
    }
    const fees = inv.fees;
    if (inv.advice && fees.equivalents.length > 0) {
      const tickers = fees.equivalents.map((e) => `${e.holding.ticker}>${e.ticker}`).sort();
      out.push({
        kind: "heads_up",
        body: `Your investments cost about ${formatCents(fees.totalYearlyCents)} a year in fees. ${equivalentLine(fees.equivalents[0])}${fees.equivalents.length > 1 ? ` I found ${fees.equivalents.length - 1} more like it.` : ""} ${switchSummary(fees.equivalents, fees.years)}`,
        refs: { advice: true },
        actions: [
          { id: "open", label: "See the fees", kind: "link", href: "/investments/fees" },
          learnLink("index-funds"),
          snoozeButton(),
        ],
        dedupeKey: `fees:${tickers.join(",")}`,
        priority: MESSAGE_PRIORITY.investment_fees,
      });
    }
    const review = inv.review;
    if (inv.advice && review && review.recommendations.length > 0) {
      const [first, ...rest] = review.recommendations;
      // Spec step 133: the orders are ready; one tap places them.
      const plan = inv.rebalance && inv.rebalance.orders.length > 0 ? inv.rebalance : null;
      out.push({
        kind: plan ? "decision" : "heads_up",
        body: `I've reviewed your investments against your ${review.riskLabel.toLowerCase()} profile. ${first.what} ${first.why}${rest.length > 0 ? ` And ${rest.length} more ${rest.length === 1 ? "change" : "changes"} on the review.` : ""}${plan ? `\nI've got the orders ready: ${planSummary(plan)} Tap and I'll place them ${SIMULATED_WORDS}.` : ""}`,
        refs: { advice: true, ...(plan ? { rebalanceKey: plan.key } : {}) },
        actions: [
          ...(plan ? [rebalanceButton()] : []),
          { id: "open", label: "See the review", kind: "link", href: "/investments/review" },
          learnLink("rebalancing"),
          snoozeButton(),
        ],
        // Step 137: drift is watched every day; while the mix stays off target Jane says so
        // again each month, with the orders ready.
        dedupeKey: `review:${review.riskLevel}:${review.recommendations.map((r) => r.kind).join(",")}:${snapshot.asOf.slice(0, 7)}`,
        priority: MESSAGE_PRIORITY.investment_review,
      });
    }
    const retirement = inv.retirement;
    if (
      inv.advice &&
      retirement &&
      (retirement.status === "behind" ||
        retirement.status === "maybe" ||
        (retirement.match !== null && !retirement.match.captured))
    ) {
      const match = matchLine(retirement);
      const first = retirement.changes[0];
      out.push({
        kind: "heads_up",
        body: [projectionLine(retirement), match, first ? `First step: ${first.what}` : null]
          .filter(Boolean)
          .join(" "),
        refs: { advice: true },
        actions: [
          {
            id: "open",
            label: "See your retirement plan",
            kind: "link",
            href: "/investments/retirement",
          },
          learnLink("the-match"),
          snoozeButton(),
        ],
        dedupeKey: `retirement:${retirement.status}:${retirement.match?.captured ?? "none"}`,
        priority: MESSAGE_PRIORITY.retirement,
      });
    }
    const order = inv.accountPlan.order;
    if (inv.advice && order) {
      const move = inv.accountPlan.location[0];
      out.push({
        kind: "heads_up",
        body: `Here's the order I'd fill your accounts in: ${order.map((s, i) => `${i + 1}. ${s.title}`).join("; ")}.${move ? ` And ${move.holding.name} is better held in ${move.better}: about ${formatCents(move.taxDragCents)} a year in tax where it is.` : ""}`,
        refs: { advice: true },
        actions: [
          { id: "open", label: "See why", kind: "link", href: "/investments/accounts" },
          learnLink("roth-vs-traditional"),
          snoozeButton(),
        ],
        dedupeKey: `accounts:${order.map((s) => s.key).join(",")}:${inv.accountPlan.location.map((m) => m.holding.ticker).join(",")}`,
        priority: MESSAGE_PRIORITY.account_order,
      });
    }
    // Step 137: the monthly note, once a month.
    const orders = inv.rebalance && inv.rebalance.orders.length > 0 ? inv.rebalance : null;
    const note = portfolioNote({
      month: inv.month.month,
      totalCents: inv.totalCents,
      previousCents: inv.month.previousCents,
      contributedCents: inv.month.contributedCents,
      feesYearlyCents: inv.fees.totalYearlyCents,
      review: inv.advice ? inv.review : null,
      ordersReady: inv.advice ? (orders?.orders.length ?? 0) : 0,
    });
    out.push({
      kind: note.decision ? "decision" : "heads_up",
      body: note.body,
      refs: {
        ...(inv.advice && inv.review ? { advice: true as const } : {}),
        ...(note.decision && orders ? { rebalanceKey: orders.key } : {}),
      },
      actions: [
        ...(note.decision ? [rebalanceButton()] : []),
        { id: "open", label: "See your investments", kind: "link", href: "/investments" },
        snoozeButton(),
      ],
      dedupeKey: `monthly:${inv.month.month}`,
      priority: MESSAGE_PRIORITY.investment_monthly,
    });
    // Step 157: each goal invested for its timeline, said once per set of goals.
    const goalBuckets = inv.goalBuckets.buckets;
    if (inv.advice && goalBuckets && goalBuckets.some((b) => b.id !== "retirement")) {
      out.push({
        kind: "heads_up",
        body: `I've given each goal its own mix, by when you need it: ${goalBuckets.map(bucketLine).join("; ")}. ${byHerselfLine(inv.goalBuckets.byHerself)}`,
        refs: { advice: true },
        actions: [
          { id: "open", label: "See each goal", kind: "link", href: "/investments/goals" },
          snoozeButton(),
        ],
        dedupeKey: `goals:${goalBuckets.map((b) => `${b.id}:${b.nearTerm ? "cash" : "invested"}`).join(",")}`,
        priority: MESSAGE_PRIORITY.goal_buckets,
      });
    }
    // Step 158: children on the tax profile and no college plan yet: Jane offers once.
    if (inv.advice && inv.college.children > 0 && inv.college.plans === 0) {
      out.push({
        kind: "heads_up",
        body: `Your tax profile has ${inv.college.children === 1 ? "a child" : `${inv.college.children} children`} under 17. Want to start saving for college? Tell me their age, like "college for my 5 year old", and I'll work out what to put aside a month and the 529 plan that comes out ahead.`,
        refs: { advice: true },
        actions: [
          { id: "open", label: "Plan for college", kind: "link", href: "/investments/college" },
          snoozeButton(),
        ],
        dedupeKey: "college:offer",
        priority: MESSAGE_PRIORITY.college,
      });
    }
    // Step 159: the HSA. Receipts are saved by herself at every level; investing the cash
    // beyond the cushion moves money, so it waits for a tap.
    const hsa = inv.hsa;
    if (hsa.receipts > 0) {
      out.push({
        kind: "done",
        body: `I've saved ${hsa.receipts} medical ${hsa.receipts === 1 ? "receipt" : "receipts"} (${formatCents(hsa.savedCents)}) to your HSA receipts vault. Paid out of pocket now, they can be paid back from an HSA tax-free later.`,
        refs: {},
        actions: [{ id: "open", label: "See the vault", kind: "link", href: "/investments/hsa" }],
        dedupeKey: `hsa:receipts:${hsa.receipts}`,
        priority: MESSAGE_PRIORITY.hsa,
      });
    }
    if (inv.advice && hsa.account && hsa.plan && hsa.plan.toInvestCents > 0) {
      out.push({
        kind: "decision",
        body: `Your HSA has ${formatCents(hsa.plan.cashCents)} in cash. Keeping a ${formatCents(hsa.plan.cushionCents)} cushion for this year's health costs, the other ${formatCents(hsa.plan.toInvestCents)} could be invested to grow untaxed. Tap and I'll invest it in a low-cost index fund ${SIMULATED_WORDS}.`,
        refs: { advice: true },
        actions: [
          {
            id: "hsa.invest",
            label: `Invest ${formatCents(hsa.plan.toInvestCents)}`,
            kind: "primary",
          },
          { id: "open", label: "See your HSA", kind: "link", href: "/investments/hsa" },
          snoozeButton(),
        ],
        dedupeKey: `hsa:invest:${hsa.plan.toInvestCents}`,
        priority: MESSAGE_PRIORITY.hsa,
      });
    } else if (inv.advice && !hsa.account && hsa.demo && hsa.receipts > 0) {
      out.push({
        kind: "decision",
        body: "An HSA would let you pay these medical costs back tax-free. Want to try a demo HSA?",
        refs: { advice: true },
        actions: [{ id: "hsa.link", label: "Link a demo HSA", kind: "primary" }, snoozeButton()],
        dedupeKey: "hsa:link",
        priority: MESSAGE_PRIORITY.hsa,
      });
    }
    // Step 235: a large deposit that isn't pay is asked about once; the plan then walks
    // through its stages in the same message, a tap each.
    for (const item of inv.sudden.items) {
      if (item.status === "asked") {
        out.push({
          kind: "decision",
          body: suddenQuestionLine(item),
          refs: { suddenId: item.id },
          actions: [...suddenQuestionButtons(), SUDDEN_LINK, snoozeButton()],
          dedupeKey: `sudden:${item.id}`,
          priority: MESSAGE_PRIORITY.sudden_money,
        });
      } else if (inv.advice && item.status === "planned" && stageButton(item)) {
        const next = item.stages.find((s) => !s.done)!;
        out.push({
          kind: "decision",
          body: planBody(item),
          refs: { advice: true, suddenId: item.id, suddenStage: next.key },
          actions: [stageButton(item)!, SUDDEN_LINK, snoozeButton()],
          dedupeKey: `sudden:${item.id}`,
          priority: MESSAGE_PRIORITY.sudden_money,
        });
      }
    }
    // Step 237: an account whose beneficiary is missing or out of date. Facts and a link, for
    // everyone (no advice, nothing moves).
    if (inv.familyFile.attention.length > 0) {
      out.push({
        kind: "heads_up",
        body: attentionLine(inv.familyFile.attention),
        refs: {},
        actions: [FILE_LINK, snoozeButton()],
        dedupeKey: `family:${inv.familyFile.attention.map((c) => `${c.accountId}${c.problems.join("")}`).join(",")}`,
        priority: MESSAGE_PRIORITY.family_file,
      });
    }
    // Step 236: a values list that the funds held don't match yet, one tap to switch.
    if (inv.advice && inv.values.plan && inv.values.plan.switches.length > 0) {
      out.push({
        kind: "decision",
        body: valuesPlanLine({ ...inv.values, advice: true, source: "" }),
        refs: { advice: true, valuesKey: inv.values.plan.key },
        actions: [valuesButton(), VALUES_LINK, snoozeButton()],
        dedupeKey: `values:${inv.values.plan.key}`,
        priority: MESSAGE_PRIORITY.values,
      });
    }
    // Step 234: money needed within three years, compared after tax; a ladder when bills win
    // by enough, one tap, every bill maturing by the date.
    if (inv.advice) {
      for (const c of inv.shortTerm.candidates) {
        if (c.hasLadder || c.gainCents < MIN_GAIN_CENTS) continue;
        out.push({
          kind: c.ladder ? "decision" : "heads_up",
          body: candidateLine(c),
          refs: { advice: true, ...(c.ladder ? { ladderKey: c.key } : {}) },
          actions: [...(c.ladder ? [ladderButton(c)] : []), SHORT_LINK, snoozeButton()],
          dedupeKey: `short:${c.key}:${Math.round(c.amountCents / 100_000)}`,
          priority: MESSAGE_PRIORITY.short_term,
        });
      }
    }
    // Step 232: a plan fund list Jane read is confirmed before it is used; once it is, the
    // cheapest mix of the plan's own funds is one tap to send.
    const menu = inv.planMenu;
    if (menu.proposed) {
      out.push({
        kind: "decision",
        body: proposedLine(menu.proposed),
        refs: { menuId: menu.proposed.id },
        actions: [...confirmButtons(), MENU_LINK, snoozeButton()],
        dedupeKey: `menu:confirm:${menu.proposed.id}`,
        priority: MESSAGE_PRIORITY.plan_menu,
      });
    }
    if (
      inv.advice &&
      menu.plan &&
      menu.plan.savingCents >= MENU_MIN_SAVING_CENTS &&
      !menu.pending
    ) {
      out.push({
        kind: "decision",
        body: `${savingLine(menu.plan)} Nothing changes until you tap.`,
        refs: { advice: true },
        actions: [changeButton(menu.plan), MENU_LINK, snoozeButton()],
        dedupeKey: `menu:change:${menu.plan.savingCents}`,
        priority: MESSAGE_PRIORITY.plan_menu,
      });
    }
    // Step 231: the right investment in the right account, when the tax saved is worth it:
    // the free swaps are one tap (the mix never changes); the taxed ones are on the page.
    const loc = inv.location.plan;
    if (inv.advice && loc && loc.savedCents >= MIN_SAVING_CENTS && loc.swaps.length > 0) {
      const button = freeButton(loc);
      out.push({
        kind: button ? "decision" : "heads_up",
        body: locationLine(loc),
        refs: { advice: true, ...(button ? { locationKey: loc.key } : {}) },
        actions: [...(button ? [button] : []), LOCATION_LINK, snoozeButton()],
        dedupeKey: `location:${loc.key}`,
        priority: MESSAGE_PRIORITY.location,
      });
    }
    // Step 216: once a year (and after a raise or a new job) one message with the whole
    // investing picture: what Jane did within the caps, what waits for a tap, every item
    // with its own button. The review moves nothing itself.
    if (inv.advice && inv.holdingCount > 0 && profileSummary(inv.profile, snapshot.asOf).complete) {
      const year = new Date(snapshot.asOf).getUTCFullYear();
      const review = reviewFor(inv, year);
      const onlyOk = review.items.every((i) => i.status === "ok");
      if (!onlyOk) {
        out.push({
          kind: review.buttons.length > 0 ? "decision" : "heads_up",
          body: review.body,
          refs: {
            advice: true,
            ...(inv.rebalance ? { rebalanceKey: inv.rebalance.key } : {}),
            ...(inv.retirementAccounts.iraAllowedCents > 0
              ? { iraCents: inv.retirementAccounts.iraAllowedCents }
              : {}),
            ...(inv.review2.harvestKey ? { harvestKey: inv.review2.harvestKey } : {}),
            ...(inv.oldAccounts.plans.find((p) => p.status === "found")
              ? { oldPlanId: inv.oldAccounts.plans.find((p) => p.status === "found")!.id }
              : {}),
          },
          actions: [...review.buttons, REVIEW_LINK, snoozeButton()],
          dedupeKey: inv.review2.raise
            ? `review:raise:${snapshot.asOf.slice(0, 7)}`
            : `review:${year}`,
          priority: MESSAGE_PRIORITY.yearly_review,
        });
      }
    }
    // Step 215: a premium that may be whole life is asked about once; a costly product's
    // yearly cost with its surrender charge (never "leave" without it), once a year.
    const costly = inv.costly;
    for (const q of costly.asked) {
      out.push({
        kind: "decision",
        body: premiumQuestion(q),
        refs: { productId: q.id },
        actions: [
          { id: "costly.yes", label: "Yes, whole life", kind: "primary" },
          { id: "costly.no", label: "No", kind: "secondary" },
          COSTLY_LINK,
          snoozeButton(),
        ],
        dedupeKey: `costly:ask:${q.id}`,
        priority: MESSAGE_PRIORITY.costly_products,
      });
    }
    if (inv.advice) {
      for (const p of costly.products) {
        if ((p.yearlyCostCents ?? 0) < MIN_YEARLY_COST_CENTS) continue;
        out.push({
          kind: "heads_up",
          body: productLine(p),
          refs: { advice: true },
          actions: [COSTLY_LINK, snoozeButton()],
          dedupeKey: `costly:product:${p.id}:${new Date(snapshot.asOf).getUTCFullYear()}`,
          priority: MESSAGE_PRIORITY.costly_products,
        });
      }
      if (costly.advisory && costly.advisory.yearlyCents >= MIN_YEARLY_COST_CENTS) {
        out.push({
          kind: "heads_up",
          body: advisoryLine(costly.advisory),
          refs: { advice: true },
          actions: [COSTLY_LINK, snoozeButton()],
          dedupeKey: `costly:advisory:${new Date(snapshot.asOf).getUTCFullYear()}`,
          priority: MESSAGE_PRIORITY.costly_products,
        });
      }
    }
    // Step 214: each rental's year in its own transactions, once a year; paying the
    // mortgage down against investing (both sides), once a year. Analysis, no buttons.
    for (const rental of inv.property.rentals) {
      if (inv.advice && rental.counts.rent > 0) {
        out.push({
          kind: "heads_up",
          body: rentalLine(rental),
          refs: { advice: true },
          actions: [PROPERTY_LINK, snoozeButton()],
          dedupeKey: `property:rental:${rental.id}:${inv.property.year}`,
          priority: MESSAGE_PRIORITY.property,
        });
      }
    }
    if (inv.advice && inv.property.paydown) {
      out.push({
        kind: "heads_up",
        body: paydownLine(inv.property.paydown),
        refs: { advice: true },
        actions: [PROPERTY_LINK, snoozeButton()],
        dedupeKey: `property:paydown:${inv.property.year}`,
        priority: MESSAGE_PRIORITY.property,
      });
    }
    // Step 213: a gift link for a child's college fund; a Roth IRA for a child who earns.
    for (const kid of inv.family.children) {
      if (inv.advice && kid.college && !kid.gift) {
        out.push({
          kind: "decision",
          body: giftOffer(kid),
          refs: { advice: true, familyPlan: kid.college.planId },
          actions: [
            { id: "family.gift_link", label: "Make a gift link", kind: "primary" },
            FAMILY_LINK,
            snoozeButton(),
          ],
          dedupeKey: `family:gift:${kid.college.planId}`,
          priority: MESSAGE_PRIORITY.family,
        });
      }
      if (inv.advice && kid.roth && kid.roth.roomCents >= 10_000) {
        out.push({
          kind: "decision",
          body: `${rothOffer(kid)} Tap and I'll put it in ${SIMULATED_WORDS}.`,
          refs: { advice: true, familyChild: kid.id, iraCents: kid.roth.roomCents },
          actions: [
            {
              id: "family.child_roth",
              label: `Put ${formatCents(kid.roth.roomCents)} in ${kid.name}'s Roth`,
              kind: "primary",
            },
            FAMILY_LINK,
            snoozeButton(),
          ],
          dedupeKey: `family:roth:${kid.id}:${new Date(snapshot.asOf).getUTCFullYear()}`,
          priority: MESSAGE_PRIORITY.family,
        });
      }
    }
    // Step 212: from 15 years before retiring, one message a year with the claiming ages, the
    // paycheck and how long it lasts. Past facts and ranges, never a promise.
    const income = inv.retirementIncome;
    if (inv.advice && income.applies && income.paycheck) {
      out.push({
        kind: "heads_up",
        body: [paycheckLine(income), ssLine(income), rmdLine(income), drawLine(income)]
          .filter(Boolean)
          .join(" "),
        refs: { advice: true },
        actions: [RI_LINK, snoozeButton()],
        dedupeKey: `retire:income:${new Date(snapshot.asOf).getUTCFullYear()}`,
        priority: MESSAGE_PRIORITY.retirement_income,
      });
    }
    // Step 211: each past employer is asked about once; a found plan with fees worth saving
    // gets a rollover offer (a tap).
    const askedPlan = inv.oldAccounts.plans.find((p) => p.status === "asked");
    if (askedPlan) {
      out.push({
        kind: "decision",
        body: questionLine(askedPlan),
        refs: { oldPlanId: askedPlan.id },
        actions: [...questionButtons(), OLD_LINK, snoozeButton()],
        dedupeKey: `oldplan:ask:${askedPlan.id}`,
        priority: MESSAGE_PRIORITY.old_plan,
      });
    }
    for (const found of inv.oldAccounts.plans.filter((p) => p.status === "found")) {
      if (!inv.advice || (found.fees?.savedCents ?? 0) < OLD_PLAN_MIN_SAVING_CENTS) continue;
      out.push({
        kind: "decision",
        body: `${foundLine(found)} Tap and I'll start a direct rollover ${SIMULATED_WORDS}.`,
        refs: { advice: true, oldPlanId: found.id },
        actions: [rollButton(), OLD_LINK, snoozeButton()],
        dedupeKey: `oldplan:roll:${found.id}`,
        priority: MESSAGE_PRIORITY.old_plan,
      });
    }
    // Step 210: the match left on the table, then IRA room (each a tap).
    const ra = inv.retirementAccounts;
    const matchText = raMatchLine(ra);
    if (inv.advice && matchText && (ra.match?.missedCents ?? 0) >= MATCH_MIN_MISSED_CENTS) {
      const button = matchButton(ra);
      out.push({
        kind: button ? "decision" : "heads_up",
        body: `${matchText} Nothing changes in your pay until you tap.`,
        refs: { advice: true },
        actions: [...(button ? [button] : []), RA_LINK, snoozeButton()],
        dedupeKey: `retire:match:${Math.round((ra.match?.missedCents ?? 0) / 100)}`,
        priority: MESSAGE_PRIORITY.retirement_accounts,
      });
    }
    const iraRoom = ra.limits.find((l) => l.key === "ira")?.roomCents ?? 0;
    const iraTap = iraButton(ra);
    if (inv.advice && iraTap && iraRoom >= ROOM_MIN_CENTS) {
      out.push({
        kind: "decision",
        body: `You can still put ${formatCents(ra.iraAllowedCents)} in your IRA this year. ${rothLine(ra)} Tap and I'll put it in ${SIMULATED_WORDS}.`,
        refs: { advice: true, iraCents: ra.iraAllowedCents },
        actions: [iraTap, RA_LINK, snoozeButton()],
        dedupeKey: `retire:ira:${new Date(snapshot.asOf).getUTCFullYear()}`,
        priority: MESSAGE_PRIORITY.retirement_accounts,
      });
    }
    // Step 164: once a month, what Jane did by herself in investing within the person's
    // caps (one line each, from the log), and what she's waiting on a tap for.
    const handled = inv.automatic;
    if (inv.advice && handled.did.length + handled.asked.length > 0) {
      out.push({
        kind: "done",
        body: summaryBody(handled.did, handled.asked),
        refs: { advice: true },
        actions: [AUTO_LOG_LINK],
        dedupeKey: `investing:summary:${snapshot.asOf.slice(0, 7)}`,
        priority: MESSAGE_PRIORITY.investing_summary,
      });
    }
    // Step 163: a big drop gets one calm message a month: what changed, what it means for
    // each goal's timeline, the plan. Never a word about what markets will do.
    const drop = detectDrop(inv.returns.periods);
    if (inv.advice && drop) {
      out.push({
        kind: "heads_up",
        body: steadyMessage(drop, inv.goalBuckets.buckets ?? []),
        refs: { advice: true },
        actions: [STEADY_LINK, snoozeButton()],
        dedupeKey: `steady:${drop.key}:${snapshot.asOf.slice(0, 7)}`,
        priority: MESSAGE_PRIORITY.steady_hand,
      });
    }
    // Step 162: cash earning what it should. Each move is a tap; with no move Jane can do,
    // she says what the person could do (open a high-yield savings account).
    const cash = inv.cash.plan;
    if (inv.advice && cash && cash.gainCents >= CASH_MIN_GAIN_CENTS) {
      out.push({
        kind: cash.moves.length > 0 ? "decision" : "heads_up",
        body: `${cashLine(cash)}${cash.moves.length > 0 ? " Each move is a tap; nothing moves until you say so." : ""}`,
        refs: { advice: true, ...(cash.moves.length > 0 ? { cashPlan: cash.key } : {}) },
        actions: [...moveButtons(cash), CASH_LINK, snoozeButton()],
        dedupeKey: `cash:${cash.key}`,
        priority: MESSAGE_PRIORITY.cash,
      });
    }
    // Step 161: crypto, read-only. Jane says once that she can see it (facts, for everyone);
    // in demo advice mode, too big a share and costly fees are flagged once each. Nothing is
    // ever traded, at any level.
    const crypto = inv.crypto;
    if (crypto.size.totalCents > 0) {
      out.push({
        kind: "done",
        body: `${sizeLine(crypto.size, crypto.sources)} It now counts in your net worth. ${NEVER_TRADES}`,
        refs: {},
        actions: [CRYPTO_LINK],
        dedupeKey: "crypto:seen",
        priority: MESSAGE_PRIORITY.crypto,
      });
      if (inv.advice && crypto.size.overShare) {
        out.push({
          kind: "heads_up",
          body: `${sizeLine(crypto.size, crypto.sources)} ${shareFlag(crypto.size)} Any change is yours to make at your exchange.`,
          refs: { advice: true },
          actions: [CRYPTO_LINK, snoozeButton()],
          dedupeKey: "crypto:share",
          priority: MESSAGE_PRIORITY.crypto,
        });
      }
    }
    if (inv.advice && crypto.fees?.flag) {
      out.push({
        kind: "heads_up",
        body: `${feeFlag(crypto.fees)} Switching exchanges is yours to do; ${NEVER_TRADES.charAt(0).toLowerCase()}${NEVER_TRADES.slice(1)}`,
        refs: { advice: true },
        actions: [CRYPTO_LINK, snoozeButton()],
        dedupeKey: "crypto:fees",
        priority: MESSAGE_PRIORITY.crypto,
      });
    }
    // Step 160: too much in the employer's stock. Jane says so with the plan, its tax cost
    // and the risk it removes, once a part is due; selling waits for the tap at every level.
    const company = inv.companyStock;
    if (inv.advice && company.concentration.overLimit) {
      const today = snapshot.asOf.slice(0, 10);
      const plan = planLine(company, today);
      if (plan && company.plan && sellDue(company, today)) {
        out.push({
          kind: "decision",
          body: `${concentrationLine(company)} ${plan} ${SELL_WORDS}`,
          refs: { advice: true, companyPlan: company.plan.key },
          actions: [sellButton(company), COMPANY_LINK, snoozeButton()],
          dedupeKey: `company:sell:${company.plan.key}`,
          priority: MESSAGE_PRIORITY.company_stock,
        });
      } else if (!company.plan) {
        out.push({
          kind: "heads_up",
          body: `${concentrationLine(company)} A common rule is to keep it under ${Math.round(EMPLOYER_STOCK_LIMIT * 100)}%, because a bad year for the company would hit your job and your savings at once. It isn't in an account I can sell from; the company stock page shows what's held where.`,
          refs: { advice: true },
          actions: [COMPANY_LINK, snoozeButton()],
          dedupeKey: "company:over",
          priority: MESSAGE_PRIORITY.company_stock,
        });
      }
    }
    const auto = inv.autoInvest;
    // Step 137: contributions kept going: a plan the person paused a month ago comes up.
    if (
      inv.advice &&
      auto.plan?.status === "paused" &&
      Date.parse(snapshot.asOf) - auto.plan.updatedAt.getTime() >=
        AUTO_PAUSED_NUDGE_DAYS * 86_400_000
    ) {
      out.push({
        kind: "decision",
        body: `Automatic investing has been paused since ${auto.plan.updatedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}. Want me to start again from your next paycheck? ${AUTO_PROMISE}`,
        refs: {},
        actions: [resumeButton(), AUTO_LINK, snoozeButton()],
        dedupeKey: `auto:paused:${auto.plan.updatedAt.toISOString().slice(0, 10)}`,
        priority: MESSAGE_PRIORITY.auto_invest_offer,
      });
    }
    if (inv.advice && inv.profile.answeredAt && !auto.plan && auto.suggestion) {
      const account = auto.accounts.find((a) => a.id === auto.suggestion!.accountId);
      out.push({
        kind: "decision",
        body: `Want me to invest for you automatically? ${formatCents(auto.suggestion.amountCents)} every payday${account ? ` into your ${account.name}` : ""}, in your mix, or the rest after bills and goals. ${AUTO_PROMISE}`,
        refs: { advice: true, autoInvest: auto.suggestion },
        actions: [...startButtons(auto.suggestion.amountCents), snoozeButton()],
        dedupeKey: "auto:offer",
        priority: MESSAGE_PRIORITY.auto_invest_offer,
      });
    }
    // Every payday, invested or paused, is said once.
    for (const run of auto.runs.slice(0, 3)) {
      out.push({
        kind: run.status === "invested" ? "done" : "heads_up",
        body: runLine(run),
        refs: {},
        actions: [...(auto.plan?.status === "active" ? [pauseButton()] : []), AUTO_LINK],
        dedupeKey: `auto:run:${run.id}`,
        priority: MESSAGE_PRIORITY.auto_invest_run,
      });
    }
    return out;
  },
};
