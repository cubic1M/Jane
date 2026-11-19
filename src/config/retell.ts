// Retell (batch-2 connectors, 11-19; docs.retellai.com, read 2026-11-19: Create Phone Call, Get Call,
// Secure the webhook, Post Call Extraction): a phone agent for the action agent's calls, in test only.
// It only ever dials a number in the range set aside for fiction (555-0100 to 555-0199, in any area
// code), so it reaches no company; calls to real companies stay off (src/lib/voice/provider.ts). Turned
// on by VOICE_PROVIDER=retell_test with the keys below; never for trial people.
export const RETELL = {
  baseUrl: "https://api.retellai.com",
  apiKeyEnv: "RETELL_API_KEY",
  // The phone agent, and the number it calls from (bought in or imported to Retell).
  agentIdEnv: "RETELL_AGENT_ID",
  fromNumberEnv: "RETELL_FROM_NUMBER",
  switchEnv: "VOICE_PROVIDER",
  switchValue: "retell_test",
  signatureHeader: "x-retell-signature",
  // "Check that the timestamp is within 5 minutes" (Secure the webhook).
  toleranceMs: 5 * 60 * 1000,
  // E.164 numbers in the fiction range: +1, a geographic area code (toll-free 8xx 555 numbers are
  // real), then 555-01xx.
  fictionNumber: /^\+1(?!8(?:00|33|44|55|66|77|88))[2-9]\d{2}55501\d{2}$/,
  // The fiction number the test agent calls, the E.164 form of SIMULATED_NUMBER's 555-0100.
  simulatedCompanyNumber: "+12025550100",
  // Retell's disconnection reasons that mean nobody answered (Get Call: disconnection_reason).
  noAnswerReasons: [
    "dial_no_answer",
    "dial_busy",
    "dial_failed",
    "voicemail_reached",
    "invalid_destination",
  ],
} as const;
