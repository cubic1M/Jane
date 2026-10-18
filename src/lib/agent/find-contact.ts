import Anthropic from "@anthropic-ai/sdk";
import type { PrismaClient } from "@/generated/prisma/client";
import { anthropic, llmEnabled, llmModel } from "@/lib/anthropic";
import { logAudit, SYSTEM_ACTOR } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";

// Finding a company's support email (spec step 64). When the merchant directory has none,
// Claude searches the company's own website (web search limited to its domain), and an
// address is kept only if it's at that domain. It's stored as a suggestion; the agent
// never writes there until the team confirms it on /admin/merchants.

type Options = { client?: PrismaClient; claude?: typeof anthropic; now?: Date };

// The company's own domain, from the links the team already put in the directory:
// "https://secure.hulu.com/account" -> "hulu.com".
export function companyDomain(urls: (string | null)[]): string | null {
  for (const url of urls) {
    if (!url) continue;
    try {
      const labels = new URL(url).hostname.toLowerCase().split(".").filter(Boolean);
      if (labels.length >= 2) return labels.slice(-2).join(".");
    } catch {
      // Not a URL: try the next one.
    }
  }
  return null;
}

const onDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

// Pure: whether a found address and the page it came from both belong to the company.
export function acceptable(found: { email: string; sourceUrl: string }, domain: string): boolean {
  const email = found.email.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at < 1 || !/^[^\s@<>"]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) return false;
  if (!onDomain(email.slice(at + 1), domain)) return false;
  try {
    const source = new URL(found.sourceUrl);
    return source.protocol === "https:" && onDomain(source.hostname.toLowerCase(), domain);
  } catch {
    return false;
  }
}

const SCHEMA = {
  type: "object",
  properties: {
    email: { type: "string" },
    sourceUrl: { type: "string" },
  },
  required: ["email", "sourceUrl"],
  additionalProperties: false,
};

const MAX_RESUMES = 3;

// Looks up one merchant's support email and stores it as a suggestion. Returns it, or null.
export async function findSupportContact(
  merchantId: string,
  { client = defaultClient, claude = anthropic, now = new Date() }: Options = {},
): Promise<string | null> {
  if (!llmEnabled()) return null;
  const merchant = await client.merchant.findUnique({ where: { id: merchantId } });
  if (!merchant || merchant.supportEmail || merchant.suggestedSupportEmail) return null;
  const domain = companyDomain([merchant.supportUrl, merchant.cancelUrl]);
  // Without the company's own domain there's nothing to check an address against.
  if (!domain) return null;

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Find the customer support email address for ${merchant.name} (${domain}), as published on its own website. Give the address and the https page where it appears. If the site publishes no support email, answer with empty strings.`,
    },
  ];
  let response: Anthropic.Message | null = null;
  try {
    for (let i = 0; i <= MAX_RESUMES; i += 1) {
      response = await claude().messages.create({
        model: llmModel(),
        max_tokens: 4000,
        tools: [
          {
            type: "web_search_20260209",
            name: "web_search",
            max_uses: 3,
            allowed_domains: [domain],
          },
        ],
        messages,
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      });
      // A long server-side search can pause; send the turn back to resume it.
      if (response.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: response.content });
    }
  } catch (error) {
    if (!(error instanceof Anthropic.APIError)) throw error;
    console.error("Support contact lookup failed", { status: error.status });
    return null;
  }
  if (!response || response.stop_reason !== "end_turn") return null;
  const text = [...response.content].reverse().find((b) => b.type === "text");
  if (!text || text.type !== "text") return null;
  let found: { email?: unknown; sourceUrl?: unknown };
  try {
    found = JSON.parse(text.text);
  } catch {
    return null;
  }
  if (typeof found.email !== "string" || typeof found.sourceUrl !== "string") return null;
  const candidate = { email: found.email.trim().toLowerCase(), sourceUrl: found.sourceUrl.trim() };
  if (!acceptable(candidate, domain)) return null;

  await client.merchant.update({
    where: { id: merchant.id },
    data: {
      suggestedSupportEmail: candidate.email,
      suggestedSupportSource: candidate.sourceUrl,
      suggestedAt: now,
    },
  });
  await logAudit(
    SYSTEM_ACTOR,
    "support_contact_suggested",
    { type: "merchant", id: merchant.id },
    {
      domain,
    },
  );
  return candidate.email;
}
