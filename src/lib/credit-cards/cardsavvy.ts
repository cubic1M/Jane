import { CARDSAVVY } from "@/config/cardsavvy";
import { REWARD_CATEGORIES, type RewardCategory } from "@/config/credit-cards";
import type { CardProduct } from "./partner";

// A person's own card as CardSavvy's catalog describes it (src/config/cardsavvy.ts), in Jane's
// CardProduct shape: what a dollar earns on each kind of spending, valued as cash (CardSavvy's multiple
// times its point value: 3x at 1.5 cents is 4.5%, 450 basis points), and the fee. Jane works out what the
// person's own spending earned with it; CardSavvy only gets the card's name. The label says it's
// CardSavvy's, with its verification date, as its terms ask. For identifying a card the person has;
// it applies for nothing and picks no new card.

export type CardSavvyCard = {
  name?: string;
  issuer?: string | null;
  annual_fee?: number | null;
  point_value_cents?: number | null;
  modality?: string | null;
  rewards?: Record<string, unknown>;
  issuer_url?: string | null;
  is_legacy?: boolean;
  modeling_warning?: string | null;
};

// get_card's structured result: the card, its verification date and what must be shown with it.
export type CardSavvyResult = {
  result?: { card?: CardSavvyCard };
  as_of?: string | null;
  notices?: string[];
};

export class CardSavvyError extends Error {
  constructor(readonly code: string) {
    super(`CardSavvy request failed: ${code}`);
    this.name = "CardSavvyError";
  }
}

const multiple = (v: unknown) => (typeof v === "number" && v >= 0 && v <= 100 ? v : null);

// Null when CardSavvy can't say what the card earns (no base rate, no point value) or its data is
// unverified (no as_of).
export function cardSavvyProduct(found: CardSavvyResult): CardProduct | null {
  const card = found.result?.card;
  const asOf = found.as_of?.slice(0, 10);
  const point = card?.point_value_cents;
  const base = multiple(card?.rewards?.[CARDSAVVY.baseCategory]);
  if (!card?.name || !asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return null;
  if (typeof point !== "number" || point <= 0 || point > 10 || base === null) return null;
  const bps = (x: number) => Math.round(x * point * 100);
  const rateBps: Partial<Record<RewardCategory, number>> = {};
  for (const kind of REWARD_CATEGORIES) {
    if (kind === "other") continue;
    const rate = multiple(card.rewards?.[CARDSAVVY.categoryOf[kind]]);
    if (rate !== null && rate !== base) rateBps[kind] = bps(rate);
  }
  const unit = card.modality === "Cash Back" ? "% back" : "x points";
  const bonus = Object.entries(card.rewards ?? {})
    .filter(([, r]) => (multiple(r) ?? 0) > base)
    .map(([category, r]) => `${r}${unit} on ${category}`);
  const fee = typeof card.annual_fee === "number" && card.annual_fee >= 0 ? card.annual_fee : 0;
  return {
    id: `cardsavvy:${card.name}`,
    issuer: card.issuer ?? "",
    name: card.name,
    annualFeeCents: Math.round(fee * 100),
    rateBps,
    baseRateBps: bps(base),
    rewardsLabel: `${[...bonus, `${base}${unit} on everything else`].join(", ")} (${CARDSAVVY.attribution}, checked ${asOf})`,
    intro: null,
    // Not used to identify a card the person already has.
    minBand: "fair",
    sourceUrl: card.issuer_url?.startsWith("https://")
      ? card.issuer_url
      : "https://card-savvy.com/",
    demo: false,
  };
}

type Options = { fetch?: typeof fetch; now?: () => number };

const cache = new Map<string, { at: number; found: CardSavvyResult }>();

// The JSON-RPC answer in a Streamable HTTP reply: JSON, or the first SSE "data:" line.
async function rpcResult(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const json = (response.headers.get("content-type") ?? "").includes("event-stream")
    ? (/^data: (.*)$/m.exec(text)?.[1] ?? "")
    : text;
  const body = JSON.parse(json || "null") as { result?: Record<string, unknown> } | null;
  if (!response.ok || !body?.result) throw new CardSavvyError(`HTTP_${response.status}`);
  return body.result;
}

// One card's terms from CardSavvy's get_card (MCP over Streamable HTTP: initialize, then tools/call,
// each with the `_meta` envelope its server asks for). Cached a day per name.
export async function getCardSavvyCard(
  name: string,
  { fetch: send = fetch, now = Date.now }: Options = {},
): Promise<CardSavvyResult> {
  const key = name.trim().toLowerCase();
  if (!key || key.length > 120) throw new CardSavvyError("BAD_NAME");
  const hit = cache.get(key);
  if (hit && now() - hit.at < CARDSAVVY.cacheHours * 3_600_000) return hit.found;
  const meta = {
    "io.modelcontextprotocol/protocolVersion": CARDSAVVY.protocolVersion,
    "io.modelcontextprotocol/clientCapabilities": {},
  };
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": CARDSAVVY.protocolVersion,
  };
  const init = await send(CARDSAVVY.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: CARDSAVVY.protocolVersion,
        capabilities: {},
        clientInfo: { name: "jane", version: "1" },
      },
    }),
  });
  await rpcResult(init);
  const session = init.headers.get("mcp-session-id");
  const call = await send(CARDSAVVY.endpoint, {
    method: "POST",
    headers: { ...headers, ...(session ? { "mcp-session-id": session } : {}) },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_card", arguments: { name: name.trim() }, _meta: meta },
    }),
  });
  const result = await rpcResult(call);
  if (result.isError === true) throw new CardSavvyError("NOT_FOUND");
  const found = (result.structuredContent ?? null) as CardSavvyResult | null;
  if (!found?.result?.card) throw new CardSavvyError("SHAPE");
  cache.set(key, { at: now(), found });
  return found;
}

export const clearCardSavvyCache = () => cache.clear();
