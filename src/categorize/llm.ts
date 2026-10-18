import Anthropic from "@anthropic-ai/sdk";
import { ALL_DETAILED, type PfcDetailed } from "./taxonomy";

// The LLM only classifies merchants the keyword rules couldn't place. It sees cleaned
// merchant names and nothing else: no amounts, dates, account details, names or emails.

export const CATEGORIZE_PROMPT_VERSION = "categorize-v1";

const DEFAULT_MODEL = "claude-opus-5-5";
const BATCH_SIZE = 50;
const UNKNOWN = "UNKNOWN";

const SYSTEM = `You classify merchants from US bank and credit card statements into Plaid's personal finance categories.
For each merchant name, pick the single detailed category that best describes what a typical purchase there is.
Use ${UNKNOWN} when the name is too vague to tell, looks like a person's name, or could be several unrelated things.`;

const SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          merchant: { type: "string" },
          category: { type: "string", enum: [...ALL_DETAILED, UNKNOWN] },
        },
        required: ["merchant", "category"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

let client: Anthropic | undefined;

function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

export function resetLlmClientForTests(): void {
  client = undefined;
}

async function classifyBatch(merchants: string[]): Promise<Map<string, PfcDetailed>> {
  const response = await getClient().messages.create({
    model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: "user", content: JSON.stringify({ merchants }) }],
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
  });

  const results = new Map<string, PfcDetailed>();
  if (response.stop_reason !== "end_turn") return results;
  const text = response.content.find((block) => block.type === "text");
  if (!text || text.type !== "text") return results;

  const parsed = JSON.parse(text.text) as { results?: { merchant: string; category: string }[] };
  const asked = new Set(merchants);
  for (const { merchant, category } of parsed.results ?? []) {
    // Only accept answers for merchants we asked about, in categories that exist.
    if (asked.has(merchant) && (ALL_DETAILED as string[]).includes(category)) {
      results.set(merchant, category as PfcDetailed);
    }
  }
  return results;
}

// Returns a category for each merchant the model could place. Never throws for API or
// parsing problems: unplaced merchants just stay uncategorized and are retried next import.
export async function classifyMerchants(merchants: string[]): Promise<Map<string, PfcDetailed>> {
  const results = new Map<string, PfcDetailed>();
  if (!process.env.ANTHROPIC_API_KEY || merchants.length === 0) return results;

  for (let i = 0; i < merchants.length; i += BATCH_SIZE) {
    const batch = merchants.slice(i, i + BATCH_SIZE);
    try {
      for (const [merchant, category] of await classifyBatch(batch))
        results.set(merchant, category);
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        console.error("Merchant categorization failed", { status: error.status });
      } else if (error instanceof SyntaxError) {
        console.error("Merchant categorization returned invalid JSON");
      } else {
        throw error;
      }
    }
  }
  return results;
}
