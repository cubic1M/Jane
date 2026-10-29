import { FINDING_CONFIDENCE_PERCENT, type ConfidenceLevel } from "@/config/detection";
import { counted } from "@/profile/confidence";

// "90% sure, based on 14 transactions": a finding's confidence as the percentage every
// suggestion shows (spec step 254), with what it rests on. The same finding always says the same.
export function findingConfidence(finding: { confidence: ConfidenceLevel; evidence: unknown }): {
  percent: number;
  reason: string;
} {
  const evidence =
    finding.evidence && typeof finding.evidence === "object"
      ? (finding.evidence as Record<string, unknown>)
      : {};
  const seen = Array.isArray(evidence.transactions) ? evidence.transactions.length : 0;
  const accounts = Array.isArray(evidence.accounts) ? evidence.accounts.length : 0;
  return {
    percent: FINDING_CONFIDENCE_PERCENT[finding.confidence],
    reason:
      seen > 0
        ? `based on ${counted(seen, "transactions")}`
        : accounts > 0
          ? `based on ${counted(accounts, "accounts")}`
          : "based on your accounts",
  };
}
