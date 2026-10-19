import { briefSource } from "./brief";
import { didSource } from "./did";
import { findingsSource } from "./findings";
import { headsUpsSource } from "./heads-ups";
import { planSource } from "./plan";
import type { MessageSource } from "./source";

// Every message source Jane's brain gathers from (spec step 82). A new kind of message is a
// new module here, registered in this one list; its daily limit is in
// src/config/agent-chat.ts (CHAT_SOURCE_LIMITS).
export const MESSAGE_SOURCES: readonly MessageSource[] = [
  briefSource,
  findingsSource,
  planSource,
  didSource,
  headsUpsSource,
];

export type { MessageSource, SourceContext, Trigger } from "./source";
