import { debtsSource } from "./debts";
import { payoffSource } from "./payoff";
import { loansSource } from "./loans";
import { refinanceSource } from "./refinance";
import { creditSource } from "./credit";
import { bnplSource } from "./bnpl";
import { cardInterestSource } from "./card-interest";
import { creditGoalSource } from "./credit-goal";
import { carLoanSource } from "./car-loan";
import { costlyBorrowingSource } from "./costly-borrowing";
import { rentingSource } from "./renting";
import { borrowingPowerSource } from "./borrowing-power";
import { creditMonthlySource } from "./credit-monthly";
import { debtReviewSource } from "./debt-review";
import { debtTroubleSource } from "./debt-trouble";
import { homeEquitySource } from "./home-equity";
import { familyLoansSource } from "./family-loans";
import { studentLongGameSource } from "./student-long-game";
import { reportFixesSource } from "./credit-report-fixes";
import { medicalBillsSource } from "./medical-bills";
import { tightMoneySource } from "./tight-money";
import { creditBuildingSource } from "./credit-building";
import { creditCardsSource } from "./credit-cards";
import { debtAutopilotSource } from "./debt-autopilot";
import { mortgageSource } from "./mortgage";
import { studentSource } from "./student";
import { transfersSource } from "./transfers";
import type { MessageSource } from "./source";

// Every message source about loans and debt (spec Phase Y), registered in ./index.ts in
// one place.
export const DEBT_SOURCES: readonly MessageSource[] = [
  debtsSource,
  payoffSource,
  refinanceSource,
  loansSource,
  transfersSource,
  studentSource,
  mortgageSource,
  creditSource,
  debtAutopilotSource,
  creditCardsSource,
  creditBuildingSource,
  bnplSource,
  tightMoneySource,
  medicalBillsSource,
  reportFixesSource,
  cardInterestSource,
  studentLongGameSource,
  familyLoansSource,
  creditGoalSource,
  homeEquitySource,
  debtTroubleSource,
  debtReviewSource,
  carLoanSource,
  costlyBorrowingSource,
  rentingSource,
  borrowingPowerSource,
  creditMonthlySource,
];
