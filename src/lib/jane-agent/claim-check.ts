import type { PrismaClient } from "@/generated/prisma/client";
import {
  CLAIM_CHECK_COUNTER_PREFIX,
  claimCheckMode,
  type ClaimCheckMode,
} from "@/config/claim-check";
import { db as defaultClient } from "@/lib/db";
import { log } from "@/lib/log";
import { systemDb } from "@/lib/system-db";
import { isTrialUser } from "@/lib/trial-ids";

// Gate E's option (c), in log mode (manager 11-17): a check by kind of claim, not by wording. The
// guardrail list blocks the wordings it has seen ("Chase will waive the fee") and misses the next
// one ("Your bank won't charge an overdraft fee on that"); this flags any sentence that states what
// a law or a company must do, promises an outcome, says someone qualifies, or calls something safe,
// unless it is Jane speaking, an offer, a condition, or something the person's own records say.
// It only reports: the reply is never changed (src/config/claim-check.ts).

export type ClaimCategory = "legal" | "outcome" | "eligibility" | "safety";

const CATEGORIES: [ClaimCategory, RegExp][] = [
  [
    "legal",
    /\b(?:has to|have to|must|is required|are required|by law|legally|(?:is|are) entitled|entitled to|ha(?:s|ve) the right|can(?:'|’)?t(?! wait)|cannot|(?:is|are)(?:n(?:'|’)?t| not) allowed|(?:does|do)(?:n(?:'|’)?t| not) have to)\b/i,
  ],
  ["eligibility", /\b(?:qualify|qualifies|eligible)\b/i],
  [
    "outcome",
    /\b(?:will(?!-)|won(?:'|’)?t|(?:is|are) going to|never|always|guarantee\w*|definitely|for sure)\b|(?:'|’)ll\b/i,
  ],
  [
    "safety",
    /\b(?:(?:is|are) (?:safe|insured|protected)(?! to\b)|covers|(?:will|(?:'|’)ll|does|do|fully|still|should) cover|builds?)\b|n(?:'|’)?t (?:affect|hurt)\b/i,
  ],
];

// Not a claim: Jane speaking or offering, a condition, a step for them, a list line, a fact read
// from their own records or a company's terms, or Jane's own figures. Tuned on correct text only
// (the must-pass lines and the backup replies), never on the claims it is measured against.
const NOT_A_CLAIM = [
  /(?:^|\s)(?:I|I(?:'|’)(?:d|ll|m|ve)|Jane)\b|^(?:Want|Ask|Add|Tell|If|When|Until|For)\b|^- |\(demo\)|from its record|lending partner|tax professional/,
  /\b(?:per (?:your|the|its|their)|according to (?:your|the)|says|said|letter|statement shows|terms)\b/i,
  /(?:would save|could save|you(?:'|’)d save|saves? (?:you )?(?:about )?\$|to save|would cut|would lower)/i,
  // A figure and a day from their data ("Your premium will go up $15.49 on Dec 1"), or what a step
  // of Jane's would do in dollars ("This will lower your bill by $15.49 a month").
  /(?:\$\d[\d,]*(?:\.\d\d)?|\d+(?:\.\d+)?%)[^.!?]*\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d|\b(?:will|would|could) (?:lower|cut|reduce|save)\b[^.!?]*\$\d/,
];

const sentences = (text: string) =>
  text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

// The kinds of claim in the text, each once, in a fixed order.
export function claimCategories(text: string): ClaimCategory[] {
  const found = new Set<ClaimCategory>();
  for (const sentence of sentences(text)) {
    if (NOT_A_CLAIM.some((pattern) => pattern.test(sentence))) continue;
    for (const [category, pattern] of CATEGORIES) if (pattern.test(sentence)) found.add(category);
  }
  return CATEGORIES.map(([category]) => category).filter((c) => found.has(c));
}

const WHY = "A daily count of chat replies by kind of claim: no person and no words in it";

const utcDay = (date: Date) => new Date(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`);

// Runs the check on a reply the person is about to see and reports what it would have flagged:
// the categories and where the reply came from, never the words, the figures or who. Trial people
// are sample data and stay out of the count. A failure to count never costs the person the reply.
export async function noteClaims(
  userId: string,
  text: string,
  source: string,
  {
    client = defaultClient,
    now = new Date(),
    mode = claimCheckMode(),
  }: { client?: PrismaClient; now?: Date; mode?: ClaimCheckMode } = {},
): Promise<ClaimCategory[]> {
  if (mode === "off") return [];
  const categories = claimCategories(text);
  if (categories.length === 0 || isTrialUser(userId)) return categories;
  log.json("claim_check", { mode, source, categories });
  const windowStart = utcDay(now);
  try {
    for (const category of categories) {
      const key = `${CLAIM_CHECK_COUNTER_PREFIX}${source}:${category}`;
      await systemDb(WHY, client).$executeRaw`
        INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, ${windowStart}, 1)
        ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1`;
    }
  } catch (error) {
    log.error("Counting a claim check failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
  }
  return categories;
}
