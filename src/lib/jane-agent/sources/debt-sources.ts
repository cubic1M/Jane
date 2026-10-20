import { debtsSource } from "./debts";
import { payoffSource } from "./payoff";
import { loansSource } from "./loans";
import { refinanceSource } from "./refinance";
import { creditSource } from "./credit";
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
];
