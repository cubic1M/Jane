import { CRYPTO_SHARE_FLAG } from "@/config/crypto";
import type { CryptoFees, CryptoSize } from "@/insights/crypto";
import { formatCents } from "@/lib/money";
import type { MessageAction } from "../types";
import { formatPercentTenths } from "@/lib/percent";

// Crypto in the chat (spec step 161): the words Jane's messages, reply and tool share.
// Facts for everyone; the two flags only in demo advice mode. Never a trade.

export const CRYPTO_LINK: MessageAction = {
  id: "open",
  label: "See your crypto",
  kind: "link",
  href: "/investments/crypto",
};

export const NEVER_TRADES = "I only read it: I never buy, sell or move crypto.";

export const sizeLine = (size: CryptoSize, sources: string[]) =>
  `Your crypto is ${formatCents(size.totalCents)}, ${formatPercentTenths(size.share)} of everything you've invested, from ${sources.join(" and ")} (read-only).`;

export const shareFlag = (_size: CryptoSize) =>
  `That's above the ${formatPercentTenths(CRYPTO_SHARE_FLAG)} a common rule of thumb keeps a speculative holding to: crypto can fall by half or more in a year.`;

export const feeFlag = (fees: CryptoFees) =>
  `Your exchange's fees came to ${formatCents(fees.feesCents)} on ${formatCents(fees.tradedCents)} of trades this past year (${(fees.bps ?? 0) / 100}%). A low-cost exchange would charge about ${formatCents(fees.lowCostCents.lowCents)} to ${formatCents(fees.lowCostCents.highCents)} for the same.`;
