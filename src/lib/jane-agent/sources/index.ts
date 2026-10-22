import { briefSource } from "./brief";
import { DEBT_SOURCES } from "./debt-sources";
import { didSource } from "./did";
import { findingsSource } from "./findings";
import { insuranceSource } from "./insurance";
import { headsUpsSource } from "./heads-ups";
import { planSource } from "./plan";
import type { MessageSource } from "./source";
import { autopilotSource } from "./autopilot";
import { budgetsSource } from "./budgets";
import { setupSource } from "./setup";
import { stepsSource } from "./steps";
import { thingsSource } from "./things";
import { taxesSource } from "./taxes";
import { changesSource } from "./changes";
import { lifeSource } from "./life";
import { upkeepSource } from "./upkeep";
import { foundPoliciesSource } from "./found-policies";
import { savedSource } from "./saved";
import { welcomeSource } from "./welcome";
import { checkedSource } from "./checked";
import { paycheckSource } from "./paycheck";
import { billPaySource } from "./billpay";
import { healthSource } from "./health";
import { attentionSource } from "./attention";
import { leanSource } from "./lean";
import { booksSource } from "./books";
import { questionsSource } from "./questions";
import { suggestionsSource } from "./suggestions";
import { steadySource } from "./steady";
import { twoSource } from "./two";
import { unusualSource } from "./unusual";
import { reportSource } from "./report";
import { investmentsSource } from "./investments";

// Every message source Jane's brain gathers from (spec step 82). A new kind of message is a
// new module here, registered in this one list; its daily limit is in
// src/config/agent-chat.ts (CHAT_SOURCE_LIMITS).
export const MESSAGE_SOURCES: readonly MessageSource[] = [
  briefSource,
  // Loans and debt (spec Phase Y, ./debt-sources.ts).
  ...DEBT_SOURCES,
  findingsSource,
  // Insurance (spec Phase X).
  insuranceSource,
  planSource,
  didSource,
  headsUpsSource,
  // Spec step 83.
  autopilotSource,
  setupSource,
  stepsSource,
  budgetsSource,
  thingsSource,
  // Taxes (spec steps 118–127).
  taxesSource,
  // Spec step 97.
  changesSource,
  // Spec step 100.
  lifeSource,
  // Spec step 101.
  upkeepSource,
  // Spec step 99.
  foundPoliciesSource,
  // Spec step 139.
  savedSource,
  // Spec step 140.
  welcomeSource,
  // Spec step 142.
  checkedSource,
  // Spec step 144.
  paycheckSource,
  billPaySource,
  healthSource,
  attentionSource,
  leanSource,
  booksSource,
  suggestionsSource,
  steadySource,
  twoSource,
  questionsSource,
  unusualSource,
  reportSource,
  // Spec step 128 on.
  investmentsSource,
];

export type { MessageSource, SourceContext, Trigger } from "./source";
