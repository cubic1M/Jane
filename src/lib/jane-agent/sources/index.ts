import { briefSource } from "./brief";
import { didSource } from "./did";
import { findingsSource } from "./findings";
import { headsUpsSource } from "./heads-ups";
import { planSource } from "./plan";
import type { MessageSource } from "./source";
import { autopilotSource } from "./autopilot";
import { budgetsSource } from "./budgets";
import { setupSource } from "./setup";
import { stepsSource } from "./steps";
import { thingsSource } from "./things";
import { changesSource } from "./changes";
import { lifeSource } from "./life";
import { investmentsSource } from "./investments";
import { insuranceSource } from "./insurance";

// Every message source Jane's brain gathers from (spec step 82). A new kind of message is a
// new module here, registered in this one list; its daily limit is in
// src/config/agent-chat.ts (CHAT_SOURCE_LIMITS).
export const MESSAGE_SOURCES: readonly MessageSource[] = [
  briefSource,
  findingsSource,
  planSource,
  didSource,
  headsUpsSource,
  // Spec step 83.
  autopilotSource,
  setupSource,
  stepsSource,
  budgetsSource,
  thingsSource,
  // Spec step 97.
  changesSource,
  // Spec step 100.
  lifeSource,
  // Spec step 128 on.
  investmentsSource,
  // Insurance (spec Phase X).
  insuranceSource,
];

export type { MessageSource, SourceContext, Trigger } from "./source";
