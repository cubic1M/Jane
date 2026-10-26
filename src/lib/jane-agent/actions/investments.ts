import { PROFILE_QUESTIONS } from "@/config/investing";
import { answerProfileQuestion } from "@/lib/investments/profile";
import { loadRebalance, placeRebalance, RebalanceError } from "@/lib/investments/rebalance";
import {
  AutoInvestError,
  setAutoInvestStatus,
  startAutoInvest,
} from "@/lib/investments/auto-invest";
import { AUTO_LINK, runLine } from "../investments/auto-copy";
import { CollegeError, startCollegePlan } from "@/lib/investments/college";
import { HsaError, investHsaCash, linkDemoHsa } from "@/lib/investments/hsa";
import {
  CompanyStockError,
  linkDemoStockPlan,
  loadCompanyStock,
  sellPart,
} from "@/lib/investments/company-stock";
import { formatCents } from "@/lib/money";
import { nextQuestion, profileSummary, questionAfter } from "@/planning/investor-profile";
import { asking } from "../investments/profile-question";
import { COMPANY_LINK } from "../investments/company-copy";
import { CRYPTO_LINK, NEVER_TRADES } from "../investments/crypto-copy";
import { CryptoError, linkDemoCrypto } from "@/lib/crypto/crypto";
import { CashError, moveCash } from "@/lib/investments/cash";
import {
  contributeToIra,
  requestMatchRaise,
  RetirementAccountsError,
} from "@/lib/investments/retirement-accounts";
import { answerOldPlan, OldAccountsError, startRollover } from "@/lib/investments/old-accounts";
import { contributeForChild, createGiftLink, FamilyError } from "@/lib/investments/family";
import { answerPremium, CostlyProductError } from "@/lib/investments/costly-products";
import {
  classify,
  doStage,
  loadSuddenMoney,
  SuddenMoneyError,
} from "@/lib/investments/sudden-money";
import { applyValues, ValuesError } from "@/lib/investments/values";
import { VALUES_LINK } from "../investments/values-copy";
import { ACTION_KIND, planBody, stageButton, SUDDEN_LINK } from "../investments/sudden-copy";
import type { StageKey } from "@/planning/sudden-money";
import { ShortTermError, startLadder } from "@/lib/investments/short-term";
import { SHORT_LINK } from "../investments/short-term-copy";
import { confirmMenu, PlanMenuError, requestPlanChange } from "@/lib/investments/plan-menu";
import { MENU_LINK } from "../investments/menu-copy";
import { LocationError, makeSwaps } from "@/lib/investments/location";
import { LOCATION_LINK } from "../investments/location-copy";
import { harvestFromReview, ReviewError } from "@/lib/investments/yearly-review";
import { REVIEW_LINK } from "../investments/review-copy";
import { COSTLY_LINK } from "../investments/costly-copy";
import { FAMILY_LINK } from "../investments/family-copy";
import { OLD_LINK } from "../investments/old-accounts-copy";
import { setPaused } from "@/lib/practice/autopilot";
import { NoPracticePortfolio } from "@/lib/practice/broker";
import { PAUSE as PRACTICE_PAUSE_LINK, PRACTICE_ONLY_NOTE } from "../investments/practice-copy";
import { adviceMode } from "@/lib/advice-mode";
import { RA_LINK } from "../investments/retirement-accounts-copy";
import { loadSteadyHand } from "@/lib/investments/steady-hand";
import { pauseNote } from "../investments/steady-copy";
import { CASH_LINK } from "../investments/cash-copy";
import { mixLine, SIMULATED_WORDS } from "../investments/rebalance-copy";
import type { ActionId } from "../types";
import { answeredElsewhere, ChatActionError, type ActionHandler } from "./handler";

// An answer button on Jane's investor-profile question (spec step 129), saved through the
// profile's own code like the profile page. The message stays open with the next question
// until all four are in. Jane never answers for the person, at any autopilot level.

function answer(position: number): ActionHandler {
  return {
    id: `invest.answer.${position}` as ActionId,
    on: "open",
    async run({ userId, message, action, client, now }) {
      const question = PROFILE_QUESTIONS.find((q) => q.key === message.refs.investQuestion);
      const choice = question?.choices[position - 1];
      if (!question || !choice) {
        throw new ChatActionError("not_offered", "That button isn't on this message.");
      }
      const answers = await answerProfileQuestion(userId, question.key, choice.value, {
        client,
        now,
      });
      const again = message.refs.investAgain === true;
      const next = again ? questionAfter(question.key) : nextQuestion(answers);
      if (next) {
        const ask = asking(next, again);
        return {
          status: "open",
          answeredWith: null,
          refs: { ...message.refs, ...ask.refs },
          note: ask.refs.note,
          actions: ask.actions,
        };
      }
      const summary = profileSummary(answers, now.toISOString().slice(0, 10));
      const { investQuestion: _, investAgain: __, ...refs } = message.refs;
      return {
        answeredWith: action.label,
        refs,
        note: summary.complete
          ? `Thanks. Your profile: ${summary.why} You can change it any time.`
          : "Thanks.",
        actions: [
          { id: "open", label: "See your profile", kind: "link", href: "/investments/profile" },
        ],
      };
    },
  };
}

export const investAnswer1 = answer(1);
export const investAnswer2 = answer(2);
export const investAnswer3 = answer(3);
export const investAnswer4 = answer(4);
export const investAnswer5 = answer(5);

// "Move to the recommended mix" (spec step 133): places the plan's orders through the
// brokerage partner's own code, as the rebalance page does, only while the plan is the
// one the message showed. Moving money always needs this tap, at every autopilot level.
export const investRebalance: ActionHandler = {
  id: "invest.rebalance",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const key = message.refs.rebalanceKey;
    if (!key) throw new ChatActionError("not_offered", "That button isn't on this message.");
    try {
      const planned = (await loadRebalance(userId, { client, now })).plan;
      const sells = (planned?.orders ?? [])
        .filter((o) => o.side === "sell")
        .reduce((s, o) => s + o.amountCents, 0);
      const paused =
        sells > 0 ? await pauseFirst({ userId, message, action, client, now }, sells) : null;
      if (paused) return paused;
      const { confirmations, plan } = await placeRebalance(userId, key, { client, now });
      const filled = confirmations.filter((c) => c.status === "filled").length;
      return {
        answeredWith: action.label,
        note: `Done ${SIMULATED_WORDS}: ${filled} of ${confirmations.length} orders filled. Your mix is now ${mixLine(plan.after)}.`,
        actions: [
          { id: "open", label: "See the orders", kind: "link", href: "/investments/rebalance" },
        ],
      };
    } catch (error) {
      if (error instanceof RebalanceError) throw answeredElsewhere(error.message);
      throw error;
    }
  },
};

// Automatic investing (spec step 134): starting it is the person's one tap; after that Jane
// runs it on every payday itself. Through automatic investing's own code, like its page.
function autoStart(id: ActionId, mode: "fixed" | "leftover"): ActionHandler {
  return {
    id,
    on: "open",
    async run({ userId, message, action, client, now }) {
      const offer = message.refs.autoInvest;
      if (!offer) throw new ChatActionError("not_offered", "That button isn't on this message.");
      try {
        const run = await startAutoInvest(
          userId,
          {
            mode,
            amountCents: mode === "fixed" ? offer.amountCents : null,
            accountId: offer.accountId,
          },
          { client, now },
        );
        return {
          answeredWith: action.label,
          note: `It's on. ${run ? runLine(run) : "I'll start with your next paycheck."}`,
          actions: [AUTO_LINK],
        };
      } catch (error) {
        if (error instanceof AutoInvestError) throw answeredElsewhere(error.message);
        throw error;
      }
    },
  };
}

export const investAutoStart = autoStart("invest.auto_start", "fixed");
export const investAutoLeftover = autoStart("invest.auto_leftover", "leftover");

function autoStatus(id: ActionId, status: "active" | "paused"): ActionHandler {
  return {
    id,
    on: "open",
    async run({ userId, action, client }) {
      try {
        await setAutoInvestStatus(userId, status, { client });
      } catch (error) {
        if (error instanceof AutoInvestError) throw answeredElsewhere(error.message);
        throw error;
      }
      return {
        answeredWith: action.label,
        note:
          status === "paused"
            ? "Paused. I won't invest from your paychecks until you turn it back on."
            : "Back on from your next paycheck.",
        actions: [AUTO_LINK],
      };
    },
  };
}

// Spec step 297: the practice portfolio's switch, from a button Claude offered. Practice money
// only, and only in demo advice mode; the next daily scan sees it.
function practiceSwitch(id: ActionId, paused: boolean): ActionHandler {
  return {
    id,
    on: "open",
    async run({ userId, message, action, client }) {
      const which = message.refs.practiceWhich ?? "all";
      if (!(await adviceMode(userId, { client }))) throw answeredElsewhere(PRACTICE_ONLY_NOTE);
      try {
        await setPaused(userId, which, paused, { client });
      } catch (error) {
        if (error instanceof NoPracticePortfolio) throw answeredElsewhere(error.message);
        throw error;
      }
      const what = which === "all" ? "your practice portfolio" : "opportunities";
      return {
        answeredWith: action.label,
        note: paused
          ? `Paused ${what}. It takes effect before the next daily scan.`
          : `Resumed ${what}. The next daily scan picks up from here.`,
        actions: [PRACTICE_PAUSE_LINK],
      };
    },
  };
}
export const practicePause = practiceSwitch("practice.pause", true);
export const practiceResume = practiceSwitch("practice.resume", false);

export const investAutoPause = autoStatus("invest.auto_pause", "paused");
export const investAutoResume = autoStatus("invest.auto_resume", "active");

// Spec step 158: "Start saving for college", through college savings' own code (the page's).
// It saves a goal; step 157's buckets and automatic investing fund it from then on.
export const collegeStart: ActionHandler = {
  id: "college.start",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const college = message.refs.college;
    if (!college) throw new ChatActionError("not_offered", "That button isn't on this message.");
    try {
      const { goal } = await startCollegePlan(userId, college, { client, now });
      return {
        answeredWith: action.label,
        note: `Done: a goal of ${formatCents(goal.targetCents)} by September ${goal.targetDate.slice(0, 4)}. I'll invest for it with your other goals; turn on automatic investing and it fills every payday.`,
        actions: [
          { id: "open", label: "See college savings", kind: "link", href: "/investments/college" },
        ],
      };
    } catch (error) {
      if (error instanceof CollegeError) throw answeredElsewhere(error.message);
      throw error;
    }
  },
};

// Spec step 159: link a demo HSA, and invest its cash beyond the cushion (the HSA page's
// own code; investing moves money, so it's always the person's tap).
export const hsaLink: ActionHandler = {
  id: "hsa.link",
  on: "open",
  async run({ userId, action, client, now }) {
    try {
      await linkDemoHsa(userId, { client, now });
    } catch (error) {
      if (error instanceof HsaError) throw answeredElsewhere(error.message);
      throw error;
    }
    return {
      answeredWith: action.label,
      note: "Linked. I'll keep your HSA's cash cushion and tell you when there's money to invest.",
      actions: [{ id: "open", label: "See your HSA", kind: "link", href: "/investments/hsa" }],
    };
  },
};

export const hsaInvest: ActionHandler = {
  id: "hsa.invest",
  on: "open",
  async run({ userId, action, client, now }) {
    try {
      const { amountCents } = await investHsaCash(userId, { client, now });
      return {
        answeredWith: action.label,
        note: `Done in the simulated brokerage (no real money moves): ${formatCents(amountCents)} of your HSA cash invested.`,
        actions: [{ id: "open", label: "See your HSA", kind: "link", href: "/investments/hsa" }],
      };
    } catch (error) {
      if (error instanceof HsaError) throw answeredElsewhere(error.message);
      throw error;
    }
  },
};

// Spec step 160: link a demo stock plan, and sell one part of the company stock plan (the
// company stock page's own code). Selling is always the person's tap, one part at a time,
// at every autopilot level.
export const companyLink: ActionHandler = {
  id: "company.link",
  on: "open",
  async run({ userId, action, client, now }) {
    try {
      await linkDemoStockPlan(userId, { client, now });
    } catch (error) {
      if (error instanceof CompanyStockError) throw answeredElsewhere(error.message);
      throw error;
    }
    return {
      answeredWith: action.label,
      note: "Linked. I'll keep an eye on how much of your investing is in your company's stock.",
      actions: [COMPANY_LINK],
    };
  },
};

export const companySell: ActionHandler = {
  id: "company.sell",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const key = message.refs.companyPlan;
    if (!key) throw new ChatActionError("not_offered", "That button isn't on this message.");
    try {
      const first = (await loadCompanyStock(userId, { client, now })).plan?.parts[0];
      const paused = first
        ? await pauseFirst({ userId, message, action, client, now }, first.proceedsCents)
        : null;
      if (paused) return paused;
      const { part } = await sellPart(userId, key, { client, now });
      return {
        answeredWith: action.label,
        note: `Done ${SIMULATED_WORDS}: sold ${formatCents(part.proceedsCents)} of company stock and bought broad index funds with it. Estimated tax on the gain: about ${formatCents(part.taxCents)}. I'll remind you when the next part is due.`,
        actions: [COMPANY_LINK],
      };
    } catch (error) {
      if (error instanceof CompanyStockError) throw answeredElsewhere(error.message);
      throw error;
    }
  },
};

// Spec step 161: connect the demo exchange, read-only. There is no crypto order button.
export const cryptoLink: ActionHandler = {
  id: "crypto.link",
  on: "open",
  async run({ userId, action, client, now }) {
    try {
      await linkDemoCrypto(userId, "exchange", { client, now });
    } catch (error) {
      if (error instanceof CryptoError) throw answeredElsewhere(error.message);
      throw error;
    }
    return {
      answeredWith: action.label,
      note: `Connected, read-only. Your crypto now counts in your net worth. ${NEVER_TRADES}`,
      actions: [CRYPTO_LINK],
    };
  },
};

// Spec step 162: one move of the cash plan, only while it's the plan the message showed.
// Moving money is always the person's tap, at every autopilot level.
function cashMove(
  id: ActionId,
  moveKey: "checking_to_savings" | "sweep_to_money_market",
): ActionHandler {
  return {
    id,
    on: "open",
    async run({ userId, message, action, client, now }) {
      const key = message.refs.cashPlan;
      if (!key) throw new ChatActionError("not_offered", "That button isn't on this message.");
      try {
        const { move, runOn } = await moveCash(userId, key, moveKey, { client, now });
        return {
          answeredWith: action.label,
          note:
            move.key === "checking_to_savings"
              ? `Scheduled through the money-movement stand-in (no real money moves): ${formatCents(move.cents)} from ${move.fromName} to ${move.toName} on ${runOn}. It stays in reach.`
              : `Done ${SIMULATED_WORDS}: ${formatCents(move.cents)} of brokerage cash in the money market fund. It can be sold the next business day.`,
          actions: [CASH_LINK],
        };
      } catch (error) {
        if (error instanceof CashError) throw answeredElsewhere(error.message);
        throw error;
      }
    },
  };
}
export const cashToSavings = cashMove("cash.to_savings", "checking_to_savings");
export const cashToMoneyMarket = cashMove("cash.to_money_market", "sweep_to_money_market");

// Spec step 163: a sell the person starts pauses once while a big drop is on, with what it
// gives up over the long run. The same button, relabelled "Sell anyway", goes straight
// through: the pause can always be skipped, and a sell never waits on a clock.
async function pauseFirst(
  { userId, message, action, client, now }: Parameters<ActionHandler["run"]>[0],
  sellCents: number,
): Promise<ReturnType<ActionHandler["run"]> | null> {
  if (message.refs.paused === true) return null;
  const steady = await loadSteadyHand(userId, { client, now });
  if (!steady.advice || !steady.drop) return null;
  return Promise.resolve({
    status: "open" as const,
    answeredWith: null,
    refs: { ...message.refs, paused: true as const },
    note: pauseNote(sellCents, steady.drop),
    actions: [
      ...message.actions
        .filter((a) => a.id === action.id)
        .map((a) => ({ ...a, label: "Sell anyway" })),
      ...message.actions.filter((a) => a.kind === "link"),
      { id: "snooze" as const, label: "Leave it a few days", kind: "secondary" as const },
    ],
  });
}

// Spec step 210: raise the contribution at work for the whole match (through the payroll
// stand-in), or put money in an IRA (through the simulated brokerage). Each is a tap.
export const retireMatch: ActionHandler = {
  id: "retire.match",
  on: "open",
  async run({ userId, action, client, now }) {
    try {
      const r = await requestMatchRaise(userId, { client, now });
      return {
        answeredWith: action.label,
        note: `Requested through the payroll stand-in (no real pay changes yet): ${Math.round(r.toRate * 1000) / 10}% of pay from ${r.effectiveOn}, to get about ${formatCents(r.missedCents)} a year more from your employer.`,
        actions: [RA_LINK],
      };
    } catch (error) {
      if (error instanceof RetirementAccountsError) throw answeredElsewhere(error.message);
      throw error;
    }
  },
};

export const retireIra: ActionHandler = {
  id: "retire.ira",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const cents = message.refs.iraCents;
    if (!cents) throw new ChatActionError("not_offered", "That button isn't on this message.");
    try {
      const r = await contributeToIra(userId, cents, { client, now });
      return {
        answeredWith: action.label,
        note: `Done ${SIMULATED_WORDS}: ${formatCents(r.amountCents)} put in ${r.accountName}.`,
        actions: [RA_LINK],
      };
    } catch (error) {
      if (error instanceof RetirementAccountsError) throw answeredElsewhere(error.message);
      throw error;
    }
  },
};

// Spec step 211: the question about a past employer's 401(k), and the rollover (a tap).
function oldPlanAnswer(id: ActionId, had: boolean): ActionHandler {
  return {
    id,
    on: "open",
    async run({ userId, message, action, client }) {
      const planId = message.refs.oldPlanId;
      if (!planId) throw new ChatActionError("not_offered", "That button isn't on this message.");
      try {
        const r = await answerOldPlan(userId, planId, had, { client });
        return {
          answeredWith: action.label,
          note: !had
            ? "Thanks. I won't ask about that one again."
            : r.found
              ? `Found it: ${r.planName}, ${formatCents(r.balanceCents)}. I'll show what it costs and how to bring it home.`
              : "I couldn't find it. The old accounts page lists ways to look.",
          actions: [OLD_LINK],
        };
      } catch (error) {
        if (error instanceof OldAccountsError) throw answeredElsewhere(error.message);
        throw error;
      }
    },
  };
}
export const oldPlanYes = oldPlanAnswer("oldplan.yes", true);
export const oldPlanNo = oldPlanAnswer("oldplan.no", false);

export const oldPlanRollover: ActionHandler = {
  id: "oldplan.rollover",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const planId = message.refs.oldPlanId;
    if (!planId) throw new ChatActionError("not_offered", "That button isn't on this message.");
    try {
      const r = await startRollover(userId, planId, { client, now });
      return {
        answeredWith: action.label,
        note: `Direct rollover requested ${SIMULATED_WORDS}: the old plan sends ${formatCents(r.balanceCents)} to your IRA itself (never a check to you, so it isn't a withdrawal), arriving about ${r.arrivesOn}. I'll tell you when it's invested.`,
        actions: [OLD_LINK],
      };
    } catch (error) {
      if (error instanceof OldAccountsError) throw answeredElsewhere(error.message);
      throw error;
    }
  },
};

// Spec step 213: a gift link for a child's college fund, and money into a child's Roth IRA.
export const familyGiftLink: ActionHandler = {
  id: "family.gift_link",
  on: "open",
  async run({ userId, message, action, client }) {
    const plan = message.refs.familyPlan;
    if (!plan) throw new ChatActionError("not_offered", "That button isn't on this message.");
    try {
      const token = await createGiftLink(userId, plan, { client });
      return {
        answeredWith: action.label,
        note: `Here's the link to share: /gift/${token}. It shows only the goal and how far along it is. You can take it down any time on the family page.`,
        actions: [FAMILY_LINK],
      };
    } catch (error) {
      if (error instanceof FamilyError) throw answeredElsewhere(error.message);
      throw error;
    }
  },
};

export const familyChildRoth: ActionHandler = {
  id: "family.child_roth",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const child = message.refs.familyChild;
    const cents = message.refs.iraCents;
    if (!child || !cents)
      throw new ChatActionError("not_offered", "That button isn't on this message.");
    try {
      const r = await contributeForChild(userId, child, "child_roth", cents, { client, now });
      return {
        answeredWith: action.label,
        note: `Done ${SIMULATED_WORDS}: ${formatCents(cents)} put in ${r.accountName}.`,
        actions: [FAMILY_LINK],
      };
    } catch (error) {
      if (error instanceof FamilyError) throw answeredElsewhere(error.message);
      throw error;
    }
  },
};

// Spec step 215: is this premium a whole life policy? Yes shows what it costs; nothing is
// cancelled or left by either button.
function costlyAnswer(id: ActionId, yes: boolean): ActionHandler {
  return {
    id,
    on: "open",
    async run({ userId, message, action, client }) {
      const productId = message.refs.productId;
      if (!productId)
        throw new ChatActionError("not_offered", "That button isn't on this message.");
      try {
        await answerPremium(userId, productId, yes, { client });
        return {
          answeredWith: action.label,
          note: yes
            ? "Thanks. Add its cash value and surrender schedule from your statement and I'll show what it really costs. I'll never tell you to leave it without those figures."
            : "Thanks. I won't ask about that one again.",
          actions: [COSTLY_LINK],
        };
      } catch (error) {
        if (error instanceof CostlyProductError) throw answeredElsewhere(error.message);
        throw error;
      }
    },
  };
}
export const costlyYes = costlyAnswer("costly.yes", true);
export const costlyNo = costlyAnswer("costly.no", false);

// Spec step 216: harvest the losses the yearly review showed (a sell into a similar fund),
// only the same list the person saw. A tap, at every autopilot level.
export const reviewHarvest: ActionHandler = {
  id: "review.harvest",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const key = message.refs.harvestKey;
    if (!key) throw new ChatActionError("not_offered", "That button isn't on this message.");
    try {
      const done = await harvestFromReview(userId, key, { client, now });
      return {
        answeredWith: action.label,
        note: `Done ${SIMULATED_WORDS}. ${done.join(". ")}.`,
        actions: [REVIEW_LINK],
      };
    } catch (error) {
      if (error instanceof ReviewError) throw answeredElsewhere(error.message);
      throw error;
    }
  },
};

// Spec step 231: the swaps that cost no tax, together (the mix never changes), a tap.
export const locationFree: ActionHandler = {
  id: "location.free",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const key = message.refs.locationKey;
    if (!key) throw new ChatActionError("not_offered", "That button isn't on this message.");
    try {
      const r = await makeSwaps(userId, key, "free", { client, now });
      return {
        answeredWith: action.label,
        note: `Done ${SIMULATED_WORDS}: ${r.swaps} ${r.swaps === 1 ? "swap" : "swaps"}, no tax, and your overall mix is unchanged.`,
        actions: [LOCATION_LINK],
      };
    } catch (error) {
      if (error instanceof LocationError) throw answeredElsewhere(error.message);
      throw error;
    }
  },
};

// Spec step 232: confirm the fund list Jane read (nothing is used before this), and send the
// cheapest mix to the payroll stand-in. Each is a tap.
export const menuConfirm: ActionHandler = {
  id: "menu.confirm",
  on: "open",
  async run({ userId, message, action, client }) {
    const id = message.refs.menuId;
    if (!id) throw new ChatActionError("not_offered", "That button isn't on this message.");
    try {
      await confirmMenu(userId, id, { client });
      return {
        answeredWith: action.label,
        note: "Saved. From now on I only suggest funds from your plan's list.",
        actions: [MENU_LINK],
      };
    } catch (error) {
      if (error instanceof PlanMenuError) throw answeredElsewhere(error.message);
      throw error;
    }
  },
};

export const menuChange: ActionHandler = {
  id: "menu.change",
  on: "open",
  async run({ userId, action, client, now }) {
    try {
      const r = await requestPlanChange(userId, { client, now });
      return {
        answeredWith: action.label,
        note: `Requested through the payroll stand-in (nothing real changes yet): ${r.funds} funds, about ${formatCents(r.savingCents)} a year less in fees.`,
        actions: [MENU_LINK],
      };
    } catch (error) {
      if (error instanceof PlanMenuError) throw answeredElsewhere(error.message);
      throw error;
    }
  },
};

// Spec step 234: start the ladder the message showed, a tap. Every bill matures by the date.
export const ladderBuild: ActionHandler = {
  id: "ladder.build",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const key = message.refs.ladderKey;
    if (!key) throw new ChatActionError("not_offered", "That button isn't on this message.");
    try {
      const r = await startLadder(userId, key, { client, now });
      return {
        answeredWith: action.label,
        note: `Started in the stand-in (no real bills are bought): ${r.rungs} ${r.rungs === 1 ? "rung" : "rungs"} for ${r.name}, every bill maturing by ${r.endsOn} and rolling over until then.`,
        actions: [SHORT_LINK],
      };
    } catch (error) {
      if (error instanceof ShortTermError) throw answeredElsewhere(error.message);
      throw error;
    }
  },
};

// Spec step 235: what the deposit was (one question), then the plan one stage at a time in
// the same message. Each stage is a tap; nothing moves by itself.
const planOutcome = async (
  userId: string,
  id: string,
  label: string,
  client: Parameters<typeof loadSuddenMoney>[1] extends infer O
    ? NonNullable<O> extends { client?: infer C }
      ? C
      : never
    : never,
  now: Date,
) => {
  const view = await loadSuddenMoney(userId, { client, now });
  const item = view.items.find((i) => i.id === id);
  const button = item ? stageButton(item) : null;
  if (!item || !button) {
    return { answeredWith: label, note: "That's all of the plan.", actions: [SUDDEN_LINK] };
  }
  const next = item.stages.find((s) => !s.done)!;
  return {
    status: "open" as const,
    answeredWith: null,
    body: planBody(item),
    refs: { advice: true as const, suddenId: id, suddenStage: next.key },
    actions: [button, SUDDEN_LINK],
  };
};

function suddenKind(id: ActionId): ActionHandler {
  return {
    id,
    on: "open",
    async run({ userId, message, action, client, now }) {
      const suddenId = message.refs.suddenId;
      if (!suddenId) throw new ChatActionError("not_offered", "That button isn't on this message.");
      try {
        await classify(userId, suddenId, ACTION_KIND[id], { client });
        if (ACTION_KIND[id] === "transfer") {
          return {
            answeredWith: action.label,
            note: "Thanks. I won't plan around it.",
            actions: [],
          };
        }
        return await planOutcome(userId, suddenId, action.label, client, now);
      } catch (error) {
        if (error instanceof SuddenMoneyError) throw answeredElsewhere(error.message);
        throw error;
      }
    },
  };
}
export const suddenKinds = Object.fromEntries(
  (
    [
      "sudden.bonus",
      "sudden.inheritance",
      "sudden.home_sale",
      "sudden.other_sale",
      "sudden.gift",
      "sudden.transfer",
    ] as const
  ).map((id) => [id, suddenKind(id)]),
) as Record<
  | "sudden.bonus"
  | "sudden.inheritance"
  | "sudden.home_sale"
  | "sudden.other_sale"
  | "sudden.gift"
  | "sudden.transfer",
  ActionHandler
>;

export const suddenStage: ActionHandler = {
  id: "sudden.stage",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const id = message.refs.suddenId;
    const stage = message.refs.suddenStage as StageKey | undefined;
    if (!id || !stage)
      throw new ChatActionError("not_offered", "That button isn't on this message.");
    try {
      const r = await doStage(userId, id, stage, { client, now });
      const out = await planOutcome(userId, id, action.label, client, now);
      return {
        ...out,
        note: `Done through the stand-ins (no real money moves): ${formatCents(r.cents)}.`,
      };
    } catch (error) {
      if (error instanceof SuddenMoneyError) throw answeredElsewhere(error.message);
      throw error;
    }
  },
};

// Spec step 236: switch to the screened funds the message showed, a tap, while the plan is
// still the one shown.
export const valuesApply: ActionHandler = {
  id: "values.apply",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const key = message.refs.valuesKey;
    if (!key) throw new ChatActionError("not_offered", "That button isn't on this message.");
    try {
      const r = await applyValues(userId, key, { client, now });
      return {
        answeredWith: action.label,
        note: `Switched ${r.switches} ${r.switches === 1 ? "fund" : "funds"} in the stand-in (no real trades are made). Fees change by ${r.plan.feeDeltaCents >= 0 ? "+" : "-"}$${(Math.abs(r.plan.feeDeltaCents) / 100).toFixed(2)} a year.`,
        actions: [VALUES_LINK],
      };
    } catch (error) {
      if (error instanceof ValuesError) throw answeredElsewhere(error.message);
      throw error;
    }
  },
};
