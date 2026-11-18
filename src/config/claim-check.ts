// The category check on chat replies (readiness gate E, option (c); src/lib/jane-agent/
// claim-check.ts): a sentence that states a law, a promised outcome, an eligibility or a safety,
// whatever its wording, rather than the guardrail list's exact wordings.
//
// "off": not run. "log": run on every chat reply, and what it would have flagged (category and
// reply source only) goes to the log and a daily counter; the reply is never changed. "on": not
// wired yet: it behaves as "log" until the founder decides to turn the check on (manager 11-17).
export const CLAIM_CHECK_MODES = ["off", "log", "on"] as const;
export type ClaimCheckMode = (typeof CLAIM_CHECK_MODES)[number];

export const CLAIM_CHECK_DEFAULT: ClaimCheckMode = "log";

// Env CLAIM_CHECK; anything else (empty, a typo) is the default.
export function claimCheckMode(value = process.env.CLAIM_CHECK): ClaimCheckMode {
  return (CLAIM_CHECK_MODES as readonly string[]).includes(value ?? "")
    ? (value as ClaimCheckMode)
    : CLAIM_CHECK_DEFAULT;
}

// The daily counter's key prefix in rate_limits, kept by the cleanup (KEEP_RATE_LIMIT_PREFIXES).
export const CLAIM_CHECK_COUNTER_PREFIX = "claimcheck:";
