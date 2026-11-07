// When an AI phone call to a company may happen (connectors roadmap round 19, voice_call_gate). FOR
// REVIEW, and counsel signs off before any real call: today calls are simulated or off
// (src/lib/voice/provider.ts callMode), and these rules are what a real one must pass first.

// States whose dialer laws reach a synthesized voice (Minnesota 325E.27; Indiana's upheld), the same
// ones Google's AI calling leaves out. Both the number's state and the person's are checked.
export const NO_AI_CALL_STATES: readonly string[] = ["IN", "LA", "MN", "MT", "NE"];

// Calling hours in the callee's own time (Indiana's autodialer law), 24-hour clock, end exclusive.
export const CALL_HOURS = { from: 9, until: 20 } as const;

// All-party consent to record a phone call (RCFP): the opener says the call is recorded, and if
// the representative objects, recording stops and notes are kept instead. Said in every call.
export const ALL_PARTY_RECORDING_STATES: readonly string[] = [
  "CA",
  "CT",
  "DE",
  "FL",
  "IL",
  "MD",
  "MA",
  "MI",
  "MT",
  "NV",
  "NH",
  "PA",
  "WA",
];

// Only a company's business line: a person's mobile or home line is the TCPA's to protect.
export const CALLABLE_LINES: readonly string[] = ["business", "toll_free"];
