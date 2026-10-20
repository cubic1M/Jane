import type { DEBT_ACTION_IDS } from "../debt-action-ids";
import { bnplPayoff } from "./bnpl";
import { cardRateSend } from "./card-interest";
import { famLoanNo, famLoanYes } from "./family-loans";
import { creditFixSend } from "./credit-report-fixes";
import { homeGoal } from "./home-buying";
import { medicalSend } from "./medical-bills";
import { tightSend } from "./tight-money";
import { creditBuilderOpen, creditBuildPay } from "./credit-building";
import { creditCardApply } from "./credit-cards";
import { debtPlanAvalanche, debtPlanSnowball } from "./debt-plan";
import type { ActionHandler } from "./handler";
import { loanAccept, loanPrepare, loanSubmit, loanWithdraw } from "./loans";
import { studentNext } from "./student";
import { transferDone, transferStart } from "./transfers";

// Every button handler about loans and debt (spec Phase Y), registered in ./index.ts in one
// place.
export const DEBT_ACTION_HANDLERS: Readonly<
  Record<(typeof DEBT_ACTION_IDS)[number], ActionHandler>
> = {
  "debt_plan.avalanche": debtPlanAvalanche,
  "debt_plan.snowball": debtPlanSnowball,
  "loan.prepare": loanPrepare,
  "loan.submit": loanSubmit,
  "loan.accept": loanAccept,
  "loan.withdraw": loanWithdraw,
  "transfer.start": transferStart,
  "transfer.done": transferDone,
  "student.next": studentNext,
  "credit_card.apply": creditCardApply,
  "credit_build.pay": creditBuildPay,
  "credit_builder.open": creditBuilderOpen,
  "bnpl.payoff": bnplPayoff,
  "tight.send": tightSend,
  "home.goal": homeGoal,
  "medical.send": medicalSend,
  "creditfix.send": creditFixSend,
  "cardrate.send": cardRateSend,
  "famloan.yes": famLoanYes,
  "famloan.no": famLoanNo,
};
