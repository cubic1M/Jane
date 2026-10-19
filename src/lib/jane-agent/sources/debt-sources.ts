import { debtsSource } from "./debts";
import type { MessageSource } from "./source";

// Every message source about loans and debt (spec Phase Y), registered in ./index.ts in
// one place.
export const DEBT_SOURCES: readonly MessageSource[] = [debtsSource];
