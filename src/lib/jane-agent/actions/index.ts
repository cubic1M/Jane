import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { closeSettled } from "../messages";
import { MESSAGE_SELECT, toChatMessage, type ActionId, type ChatMessage } from "../types";
import { DEBT_ACTION_HANDLERS } from "./debt-handlers";
import { findingNo, findingPick, findingYes } from "./finding";
import { optionLater, optionPick } from "./options";
import {
  insuranceGapNo,
  insuranceQuotes,
  insuranceShopNo,
  insuranceShopYes,
  insuranceCheckupSeen,
  insuranceClaimClose,
  insuranceClaimStart,
  insuranceClaimStep,
  benefitsConfirmAll,
  readingConfirm,
  readingDismiss,
  lifeCoverDependants0,
  lifeCoverDependants1,
  lifeCoverDependants2,
  lifeCoverDependants3,
  lifeCoverApply,
  lifeCoverYes,
  lifeCoverNo,
  lifeCoverSubmit,
  lifeCoverBuy,
  lifeCoverDismiss,
  coverApply,
  coverDismiss,
  renewalCall,
  renewalNo,
  claimFile,
  savingApplyAll,
  savingApply,
  savingNo,
  riskYes,
  riskNo,
  insuranceGapQuotes,
  benefitsDisabilityNone,
  benefitsDisabilityYes,
  benefitsLife1x,
  benefitsLife2x,
  benefitsLifeNone,
  benefitsUnsure,
} from "./insurance";
import { ChatActionError, linksOf, type ActionHandler } from "./handler";
import { markPrimerStale } from "../primer-store";
import { forgetPrimer } from "../primer-cache";
import { planApproveSafe } from "./plan";
import { undoNo, undoRule } from "./undo";
import { autopilotAll, autopilotAsk, autopilotPause, autopilotSafe } from "./autopilot";
import { alertGotIt, deadlineDone, snooze } from "./heads-ups";
import { setupAll, setupNo, setupYes } from "./setup";
import { cancelDone, offerAccept, offerDecline } from "./steps";
import { goalStart } from "./goal";
import { clarifyOne, clarifyThree, clarifyTwo } from "./clarify";
import { TAX_PROFILE_HANDLERS, taxFoundYes, taxIncomeAdd, taxIncomeNo, taxStateSet } from "./taxes";
import { taxFormGot, taxTagNo, taxTagSet, taxTagYes } from "./tax-organizer";
import { taxW4Keep, taxW4Next, taxW4Sent, taxW4Start, taxW4Stop } from "./tax-w4";
import { taxSaveNo, taxSaveTask } from "./tax-savings";
import { taxMilesAdd, taxQuarterPaid } from "./tax-self-employed";
import { taxRefundApply, taxRefundNo } from "./tax-refund";
import { taxFileStart } from "./tax-filing";
import {
  taxLocal1,
  taxLocal2,
  taxLocalNo,
  taxMoveNo,
  taxMoveSet,
  taxMoveYes,
  taxWorkSet,
} from "./tax-states";
import { taxDocAsk, taxDocChase, taxDocRight, taxDocsTick } from "./tax-documents";
import { taxPlanAdd, taxPlanNo } from "./tax-plan";
import { taxRecordsRemind } from "./audit-records";
import { taxAmendPrepare, taxPriorConfirm, taxPriorNo } from "./prior-return";
import {
  taxNoticeAgree,
  taxNoticeConfirm,
  taxNoticeDispute,
  taxNoticeMine,
  taxNoticeNo,
  taxNoticePay,
  taxNoticeTeam,
} from "./tax-notice";
import {
  taxIdentityNot,
  taxIdentityOpen,
  taxIdentityStep,
  taxIpPinHave,
  taxIpPinRemind,
} from "./tax-identity";
import { taxDisasterLoss, taxDisasterMove } from "./tax-disaster";
import { taxDraftConfirm, taxDraftDismiss } from "./tax-draft";
import { taxEquityAside } from "./tax-equity";
import { taxYearsPlan } from "./tax-years";
import { taxAccountantSeen } from "./tax-accountant";
import { taxEstimatePay, taxYearEndPlan } from "./tax-calendar";
import {
  taxExemptionClaimed,
  taxExemptionRemind,
  taxPropertyDraft,
  taxPropertyDrop,
  taxPropertyRemind,
  taxPropertySelf,
  taxPropertyTeam,
} from "./tax-property";
import { taxSideBusiness, taxSideHobby } from "./side-income";
import { taxFundOpen, taxGivingNo, taxReceiptGot } from "./giving";
import {
  investAnswer1,
  investAnswer2,
  investAnswer3,
  investAnswer4,
  investAnswer5,
  investRebalance,
  investAutoStart,
  investAutoLeftover,
  investAutoPause,
  investAutoResume,
  collegeStart,
  hsaLink,
  hsaInvest,
  companyLink,
  companySell,
  cryptoLink,
  cashToSavings,
  cashToMoneyMarket,
  retireMatch,
  retireIra,
  oldPlanYes,
  oldPlanNo,
  oldPlanRollover,
  familyGiftLink,
  familyChildRoth,
  costlyYes,
  costlyNo,
  reviewHarvest,
  locationFree,
  menuConfirm,
  menuChange,
  ladderBuild,
  suddenKinds,
  suddenStage,
  valuesApply,
} from "./investments";
import { changeBudget, changeExpected, changeLook } from "./changes";
import { lifeNever, lifeNo, lifeYes } from "./life";
import { transferCount, transferSkip, tuneUpAccept, tuneUpKeep, tuneUpUndo } from "./upkeep";
import { policyConfirm, policyNotInsurance } from "./found-policies";
import { budgetSet } from "./budget";
import { findingOptions, findingWhy } from "./explain";
import { savedShare } from "./saved";
import { prefSave, suggestNever } from "./remember";
import { welcomeTour } from "./welcome";
import { autopilotSectorSet } from "./sector";
import { paycheckMove, paycheckSkip, paycheckUndo } from "./paycheck";
import { billPay, billSkip } from "./billpay";
import { attentionResume } from "./attention";
import { whatIfAdopt } from "./whatif";
import { leanNotNow, leanStart } from "./lean";
import { askAnswer } from "./ask";
import { suggestionNo, suggestionWhy, suggestionYes } from "./suggestion";
import { steadyOn, steadyPay, steadySkip } from "./steady";
import { twoApprove, twoDecline, twoSplitEven, twoSplitIncome } from "./two";
import { tradeoffsKeep, tradeoffsPick } from "./tradeoffs";
import { unusualMe, unusualNotMe } from "./unusual";
import {
  bundleNo1,
  bundleNo2,
  bundleNo3,
  bundleNo4,
  bundleNo5,
  bundleYes1,
  bundleYes2,
  bundleYes3,
  bundleYes4,
  bundleYes5,
} from "./bundle";
import { multiCancel, multiConfirm, multiUndo } from "./multi";
import { FLOW_PICKS, flowBack, flowCancel } from "./flows";

// Every button action, by id (spec step 81). A new button is a new handler here; the
// message sources offer it by id (src/lib/jane-agent/types.ts ACTION_IDS).
export const ACTION_HANDLERS: Readonly<Record<ActionId, ActionHandler>> = {
  "finding.yes": findingYes,
  // Loans and debt (spec Phase Y, ./debt-handlers.ts).
  ...DEBT_ACTION_HANDLERS,
  "finding.no": findingNo,
  "finding.pick": findingPick,
  "option.pick": optionPick,
  "option.later": optionLater,
  // Insurance (spec Phase X).
  "insurance.gap_no": insuranceGapNo,
  "insurance.quotes": insuranceQuotes,
  "insurance.shop_yes": insuranceShopYes,
  "insurance.shop_no": insuranceShopNo,
  "insurance.checkup_seen": insuranceCheckupSeen,
  "insurance.claim_start": insuranceClaimStart,
  "insurance.claim_step": insuranceClaimStep,
  "insurance.claim_close": insuranceClaimClose,
  "benefits.confirm_all": benefitsConfirmAll,
  "reading.confirm": readingConfirm,
  "reading.dismiss": readingDismiss,
  "lifecover.dependants_0": lifeCoverDependants0,
  "lifecover.dependants_1": lifeCoverDependants1,
  "lifecover.dependants_2": lifeCoverDependants2,
  "lifecover.dependants_3": lifeCoverDependants3,
  "lifecover.apply": lifeCoverApply,
  "lifecover.yes": lifeCoverYes,
  "lifecover.no": lifeCoverNo,
  "lifecover.submit": lifeCoverSubmit,
  "lifecover.buy": lifeCoverBuy,
  "lifecover.dismiss": lifeCoverDismiss,
  "cover.apply": coverApply,
  "cover.dismiss": coverDismiss,
  "renewal.call": renewalCall,
  "renewal.no": renewalNo,
  "claim.file": claimFile,
  "saving.apply_all": savingApplyAll,
  "saving.apply": savingApply,
  "saving.no": savingNo,
  "risk.yes": riskYes,
  "risk.no": riskNo,
  "insurance.gap_quotes": insuranceGapQuotes,
  "benefits.life_1x": benefitsLife1x,
  "benefits.life_2x": benefitsLife2x,
  "benefits.life_none": benefitsLifeNone,
  "benefits.disability_yes": benefitsDisabilityYes,
  "benefits.disability_none": benefitsDisabilityNone,
  "benefits.unsure": benefitsUnsure,
  "plan.approve_safe": planApproveSafe,
  "undo.rule": undoRule,
  "undo.no": undoNo,
  // Spec step 83.
  "autopilot.safe": autopilotSafe,
  "autopilot.all": autopilotAll,
  "autopilot.ask": autopilotAsk,
  "setup.yes": setupYes,
  "setup.no": setupNo,
  "setup.all": setupAll,
  "offer.accept": offerAccept,
  "offer.decline": offerDecline,
  "cancel.done": cancelDone,
  "deadline.done": deadlineDone,
  "alert.got_it": alertGotIt,
  snooze: snooze,
  // Typing to Jane (spec step 84).
  "goal.start": goalStart,
  "autopilot.pause": autopilotPause,
  // Spec step 88.
  "clarify.1": clarifyOne,
  "clarify.2": clarifyTwo,
  "clarify.3": clarifyThree,
  // Spec step 90.
  "budget.set": budgetSet,
  "finding.why": findingWhy,
  "finding.options": findingOptions,
  // Spec step 91.
  "pref.save": prefSave,
  "suggest.never": suggestNever,
  // Spec step 92.
  "bundle.1": bundleYes1,
  "bundle.2": bundleYes2,
  "bundle.3": bundleYes3,
  "bundle.4": bundleYes4,
  "bundle.5": bundleYes5,
  "bundle.no.1": bundleNo1,
  "bundle.no.2": bundleNo2,
  "bundle.no.3": bundleNo3,
  "bundle.no.4": bundleNo4,
  "bundle.no.5": bundleNo5,
  // Spec step 185.
  "multi.confirm": multiConfirm,
  "multi.cancel": multiCancel,
  "multi.undo": multiUndo,
  // Spec step 95.
  ...FLOW_PICKS,
  "flow.back": flowBack,
  "flow.cancel": flowCancel,
  // Taxes (spec step 118).
  "tax.found_yes": taxFoundYes,
  ...TAX_PROFILE_HANDLERS,
  "tax.income_add": taxIncomeAdd,
  "tax.income_no": taxIncomeNo,
  "tax.state_set": taxStateSet,
  // Spec step 119.
  "tax.tag_yes": taxTagYes,
  "tax.tag_no": taxTagNo,
  "tax.tag_set": taxTagSet,
  "tax.form_got": taxFormGot,
  // Spec step 121.
  "tax.w4_start": taxW4Start,
  "tax.w4_next": taxW4Next,
  "tax.w4_sent": taxW4Sent,
  "tax.w4_stop": taxW4Stop,
  "tax.w4_keep": taxW4Keep,
  // Spec step 122.
  "tax.save_task": taxSaveTask,
  "tax.save_no": taxSaveNo,
  // Spec step 123.
  "tax.quarter_paid": taxQuarterPaid,
  "tax.miles_add": taxMilesAdd,
  // Spec step 125.
  "tax.refund_apply": taxRefundApply,
  "tax.refund_no": taxRefundNo,
  // Spec step 126.
  "tax.file_start": taxFileStart,
  "tax.move_yes": taxMoveYes,
  "tax.move_no": taxMoveNo,
  "tax.move_set": taxMoveSet,
  "tax.work_set": taxWorkSet,
  "tax.local_1": taxLocal1,
  "tax.local_2": taxLocal2,
  "tax.local_no": taxLocalNo,
  "tax.doc_right": taxDocRight,
  "tax.doc_ask": taxDocAsk,
  "tax.doc_chase": taxDocChase,
  "tax.docs_tick": taxDocsTick,
  "tax.plan_add": taxPlanAdd,
  "tax.plan_no": taxPlanNo,
  "tax.receipt_got": taxReceiptGot,
  "tax.fund_open": taxFundOpen,
  "tax.giving_no": taxGivingNo,
  "tax.prior_confirm": taxPriorConfirm,
  "tax.prior_no": taxPriorNo,
  "tax.amend_prepare": taxAmendPrepare,
  "tax.side_business": taxSideBusiness,
  "tax.side_hobby": taxSideHobby,
  "tax.notice_confirm": taxNoticeConfirm,
  "tax.notice_no": taxNoticeNo,
  "tax.notice_agree": taxNoticeAgree,
  "tax.notice_pay": taxNoticePay,
  "tax.notice_dispute": taxNoticeDispute,
  "tax.notice_team": taxNoticeTeam,
  "tax.notice_mine": taxNoticeMine,
  "tax.ippin_remind": taxIpPinRemind,
  "tax.disaster_move": taxDisasterMove,
  "tax.disaster_loss": taxDisasterLoss,
  "tax.draft_confirm": taxDraftConfirm,
  "tax.draft_dismiss": taxDraftDismiss,
  "tax.ippin_have": taxIpPinHave,
  "tax.identity_open": taxIdentityOpen,
  "tax.identity_not": taxIdentityNot,
  "tax.identity_step": taxIdentityStep,
  "tax.equity_aside": taxEquityAside,
  "tax.years_plan": taxYearsPlan,
  "tax.accountant_seen": taxAccountantSeen,
  "tax.estimate_pay": taxEstimatePay,
  "tax.yearend_plan": taxYearEndPlan,
  "tax.property_draft": taxPropertyDraft,
  "tax.property_remind": taxPropertyRemind,
  "tax.property_team": taxPropertyTeam,
  "tax.property_self": taxPropertySelf,
  "tax.property_drop": taxPropertyDrop,
  "tax.exemption_remind": taxExemptionRemind,
  "tax.exemption_claimed": taxExemptionClaimed,
  "tax.records_remind": taxRecordsRemind,
  // Investments (spec step 129 on).
  "invest.answer.1": investAnswer1,
  "invest.answer.2": investAnswer2,
  "invest.answer.3": investAnswer3,
  "invest.answer.4": investAnswer4,
  "invest.answer.5": investAnswer5,
  "invest.rebalance": investRebalance,
  "invest.auto_start": investAutoStart,
  "invest.auto_leftover": investAutoLeftover,
  "invest.auto_pause": investAutoPause,
  "invest.auto_resume": investAutoResume,
  "college.start": collegeStart,
  "hsa.link": hsaLink,
  "hsa.invest": hsaInvest,
  "company.link": companyLink,
  "company.sell": companySell,
  "crypto.link": cryptoLink,
  "cash.to_savings": cashToSavings,
  "cash.to_money_market": cashToMoneyMarket,
  "retire.match": retireMatch,
  "retire.ira": retireIra,
  "oldplan.yes": oldPlanYes,
  "oldplan.no": oldPlanNo,
  "oldplan.rollover": oldPlanRollover,
  "family.gift_link": familyGiftLink,
  "family.child_roth": familyChildRoth,
  "costly.yes": costlyYes,
  "costly.no": costlyNo,
  "review.harvest": reviewHarvest,
  "location.free": locationFree,
  "menu.confirm": menuConfirm,
  "menu.change": menuChange,
  "ladder.build": ladderBuild,
  ...suddenKinds,
  "sudden.stage": suddenStage,
  "values.apply": valuesApply,
  // Jane notices changes (spec step 97).
  "change.look": changeLook,
  "change.budget": changeBudget,
  "change.expected": changeExpected,
  // Life events spotted (spec step 100).
  "life.yes": lifeYes,
  "life.no": lifeNo,
  "life.never": lifeNever,
  // Plans that keep up (spec step 101).
  "tuneup.accept": tuneUpAccept,
  "tuneup.keep": tuneUpKeep,
  "tuneup.undo": tuneUpUndo,
  "transfer.count": transferCount,
  "transfer.skip": transferSkip,
  // Insurance found from payments (spec step 99).
  "policy.confirm": policyConfirm,
  "policy.not_insurance": policyNotInsurance,
  // What Jane saved you (spec step 139).
  "saved.share": savedShare,
  // Help inside the chat (spec step 140).
  "welcome.tour": welcomeTour,
  // One autopilot, every sector (spec step 141).
  "autopilot.sector_set": autopilotSectorSet,
  // Money that moves itself (spec step 144).
  "paycheck.move": paycheckMove,
  "paycheck.skip": paycheckSkip,
  "paycheck.undo": paycheckUndo,
  "bill.pay": billPay,
  "bill.skip": billSkip,
  "attention.resume": attentionResume,
  "whatif.adopt": whatIfAdopt,
  "lean.start": leanStart,
  "lean.not_now": leanNotNow,
  "ask.answer.1": askAnswer(1),
  "ask.answer.2": askAnswer(2),
  "ask.answer.3": askAnswer(3),
  "ask.answer.4": askAnswer(4),
  "ask.answer.5": askAnswer(5),
  "suggestion.yes": suggestionYes,
  "suggestion.no": suggestionNo,
  "suggestion.why": suggestionWhy,
  "steady.pay": steadyPay,
  "steady.skip": steadySkip,
  "steady.on": steadyOn,
  "two.split_income": twoSplitIncome,
  "two.split_even": twoSplitEven,
  "two.approve": twoApprove,
  "two.decline": twoDecline,
  "tradeoffs.pick": tradeoffsPick,
  "tradeoffs.keep": tradeoffsKeep,
  "unusual.me": unusualMe,
  "unusual.not_me": unusualNotMe,
};

const MESSAGE_ID = /^[a-z0-9]{1,40}$/i;

// defer: where the work the answer doesn't need (closing messages this settled, the audit
// row, the analytics event) goes, so a tap returns sooner (the chat passes next/server's
// after). Without it that work finishes before the call returns.
type Options = {
  client?: PrismaClient;
  now?: Date;
  defer?: (work: () => Promise<unknown>) => void;
  // What was chosen with the button (option.pick: the option's id); the handler checks it.
  choice?: string;
};

// A tap on a button. Checked here, whatever the page sent: the message is the person's
// own, the button is one it offers, and the message is in the state the button works on
// (still open, or within Undo's time). Returns the message as it is now.
export async function takeChatAction(
  userId: string,
  messageId: string,
  actionId: string,
  { client = defaultClient, now = new Date(), defer, choice }: Options = {},
): Promise<{
  message: ChatMessage;
  agentJobIds: (string | undefined)[];
  agentActionIds: string[];
  posted: boolean;
}> {
  const db = scopedFor(userId, client);
  const row = MESSAGE_ID.test(messageId)
    ? await db.janeMessages.findFirst({ where: { id: messageId }, select: MESSAGE_SELECT })
    : null;
  if (!row) throw new ChatActionError("not_found", "That message isn't there anymore.");
  const message = toChatMessage(row);
  const handler = Object.hasOwn(ACTION_HANDLERS, actionId)
    ? ACTION_HANDLERS[actionId as ActionId]
    : undefined;
  if (handler && message.status !== handler.on) {
    throw new ChatActionError("not_open", "This one's already been answered.");
  }
  const action = message.actions.find((a) => a.id === actionId && a.kind !== "link");
  if (!action || !handler) {
    throw new ChatActionError("not_offered", "That button isn't on this message.");
  }
  const { undoUntil } = message.refs;
  if (actionId.startsWith("undo.") && undoUntil && new Date(undoUntil) <= now) {
    throw new ChatActionError("expired", "It's too late to undo this one.");
  }

  const outcome = await handler.run({ userId, message, action, client, now, choice });
  // Spec step 93: a tap can change what's open, so Claude's copy of the numbers goes.
  forgetPrimer(userId);
  await markPrimerStale(userId, { client, now });
  // Spec step 230: each button of a debt review is its own item. The message stays open,
  // without the button just used, until every item has been dealt with.
  const review = message.refs.reviewButtons ?? [];
  const reviewTap = review.includes(actionId) && !outcome.status && !outcome.actions;
  const left = reviewTap
    ? message.actions.filter((a) => a.id !== actionId || a.kind === "link")
    : [];
  const status = reviewTap
    ? left.some((a) => a.kind !== "link" && review.includes(a.id))
      ? "open"
      : "answered"
    : (outcome.status ?? "answered");
  const refs = { ...(outcome.refs ?? message.refs) };
  if (outcome.note) refs.note = outcome.note;
  // Only if no other tap changed it meanwhile.
  await db.janeMessages.updateMany({
    where: { id: message.id, status: message.status },
    data: {
      status,
      ...(outcome.body ? { body: outcome.body } : {}),
      answeredWith: outcome.answeredWith,
      answeredAt: status === "open" ? null : now,
      refs: refs as Prisma.InputJsonObject,
      actions: (reviewTap
        ? left
        : (outcome.actions ?? linksOf(message.actions))) as Prisma.InputJsonArray,
      // Spec step 83: "Not now" hides it until then; any other answer clears that.
      snoozedUntil: outcome.snoozedUntil ?? null,
    },
  });
  // Other messages this settled (a finding approved with the whole plan) lose their buttons,
  // then the audit row and the funnel event. A tap that posted a message reloads the chat at
  // once, so it closes them first; the rest can follow the response.
  const settle = async () => {
    await logAudit(
      { type: "user", id: userId },
      "chat_action_taken",
      { type: "jane_message", id: message.id },
      { action: actionId, kind: message.kind },
    );
    await track(userId, "chat_action_taken", { action: actionId, kind: message.kind });
  };
  if (defer && !outcome.posted) {
    defer(async () => {
      await closeSettled(userId, { client, now });
      await settle();
    });
  } else {
    await closeSettled(userId, { client, now });
    if (defer) defer(settle);
    else await settle();
  }

  const updated = await db.janeMessages.findFirst({
    where: { id: message.id },
    select: MESSAGE_SELECT,
  });
  return {
    message: updated ? toChatMessage(updated) : message,
    agentJobIds: outcome.agentJobIds ?? [],
    agentActionIds: outcome.agentActionIds ?? [],
    posted: outcome.posted ?? false,
  };
}

export { ChatActionError } from "./handler";
