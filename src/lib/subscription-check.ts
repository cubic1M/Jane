import Anthropic from "@anthropic-ai/sdk";
import { anthropic, finishedText, llmEnabled, llmModel } from "@/lib/anthropic";

// Answers one question for merchants whose category can't: is a recurring charge here a
// subscription? Claude sees cleaned merchant names only: no amounts, dates, account
// details, names or emails. The detection rules still decide whether there is a finding.

export const SUBSCRIPTION_PROMPT_VERSION = "subscription-v1";

const BATCH_SIZE = 50;

const SYSTEM = `You look at merchant names from recurring charges on US bank and credit card statements.
For each name, say whether a charge that repeats at a regular interval there is most likely a subscription the person could cancel: a streaming or software plan, a membership, an app, a box or delivery plan.
Say false for rent, utilities, phone and internet bills, loans, insurance, childcare, tuition, groceries, everyday shopping, payments to people, and anything you can't tell from the name.`;

const SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          merchant: { type: "string" },
          isSubscription: { type: "boolean" },
        },
        required: ["merchant", "isSubscription"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

async function checkBatch(merchants: string[]): Promise<Map<string, boolean>> {
  const response = await anthropic().messages.create({
    model: llmModel(),
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: "user", content: JSON.stringify({ merchants }) }],
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
  });

  const answers = new Map<string, boolean>();
  const text = finishedText(response);
  if (text === null) return answers;
  const parsed = JSON.parse(text) as { results?: { merchant: string; isSubscription: boolean }[] };
  const asked = new Set(merchants);
  for (const { merchant, isSubscription } of parsed.results ?? []) {
    if (asked.has(merchant) && typeof isSubscription === "boolean") {
      answers.set(merchant, isSubscription);
    }
  }
  return answers;
}

// Maps each merchant name Claude answered for to its answer. Never throws for API or
// parsing problems: unanswered merchants are simply asked again on the next scan.
export async function checkSubscriptions(merchants: string[]): Promise<Map<string, boolean>> {
  const answers = new Map<string, boolean>();
  if (!llmEnabled() || merchants.length === 0) return answers;

  for (let i = 0; i < merchants.length; i += BATCH_SIZE) {
    try {
      for (const [merchant, answer] of await checkBatch(merchants.slice(i, i + BATCH_SIZE))) {
        answers.set(merchant, answer);
      }
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        console.error("Subscription check failed", { status: error.status });
      } else if (error instanceof SyntaxError) {
        console.error("Subscription check returned invalid JSON");
      } else {
        throw error;
      }
    }
  }
  return answers;
}
