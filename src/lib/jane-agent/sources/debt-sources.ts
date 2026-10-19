import { debtsSource } from "./debts";
import { payoffSource } from "./payoff";
import { refinanceSource } from "./refinance";
import type { MessageSource } from "./source";

// Every message source about loans and debt (spec Phase Y), registered in ./index.ts in
// one place.
export const DEBT_SOURCES: readonly MessageSource[] = [debtsSource, payoffSource, refinanceSource];
