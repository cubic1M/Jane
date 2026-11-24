import type { PrismaClient } from "@/generated/prisma/client";
import { INVOICE_MAX_CHARS } from "@/config/agent-chat";
import { merchantOf } from "@/detection/streams";
import { loadDetectionInput } from "@/detection/input";
import { db as defaultClient } from "@/lib/db";
import { explanationWords, lookUpCharge, type ChargeExplanation } from "./charge-explain";
import {
  NO_INVOICE_LINES,
  readAgainst,
  readInvoice,
  readingWords,
  type InvoiceReading,
} from "./invoice-reader";

// An invoice pasted for a charge (founder 11-24): the charge from the person's own transactions
// (a transaction id, which is only ever theirs), and the invoice's text read in memory and never
// kept by the read: the invoice page keeps none of it. Text typed into the chat, though, is stored as
// a chat message and goes to learnFromChat like any other (src/lib/jane-agent/typing.ts), so the
// answers send people to /invoice rather than asking them to paste it into the chat. The invoice page
// and Claude's read_invoice tool both come here.

type Options = { client?: PrismaClient; now?: Date };

// The charge's explanation (./charge-explain.ts), from the person's transaction by that id.
export async function loadChargeExplanation(
  userId: string,
  chargeId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<ChargeExplanation | null> {
  const lines = (await loadDetectionInput(userId, { client, now })).transactions;
  const charge = lines.find((t) => t.id === chargeId && t.amountCents > 0);
  const name = charge
    ? merchantOf({ merchantName: charge.merchantName, description: charge.description })?.name
    : null;
  if (!charge || !name) return null;
  const found = lookUpCharge(name.toLowerCase(), lines, {
    amountCents: charge.amountCents,
    day: charge.date,
    // The row they chose: a $100, a $50 and a $100 on one day each have their own explanation.
    id: charge.id,
  });
  return found.kind === "found" ? found.explanation : null;
}

export type InvoiceAnswer =
  | { ok: true; charge: string[]; reading: string[]; read: InvoiceReading }
  | { ok: false; message: string };

export async function readInvoiceFor(
  userId: string,
  text: string,
  chargeId: string | null,
  options: Options = {},
): Promise<InvoiceAnswer> {
  if (text.trim().length === 0) return { ok: false, message: "Paste the invoice's text first." };
  if (text.length > INVOICE_MAX_CHARS) {
    return {
      ok: false,
      message: `That's too long: keep it under ${INVOICE_MAX_CHARS.toLocaleString("en-US")} characters, the line items and total are enough.`,
    };
  }
  const invoice = readInvoice(text);
  if (!invoice) return { ok: false, message: NO_INVOICE_LINES };
  const explanation = chargeId ? await loadChargeExplanation(userId, chargeId, options) : null;
  const read = readAgainst(invoice, explanation);
  return {
    ok: true,
    charge: explanation ? explanationWords(explanation) : [],
    reading: readingWords(read),
    read,
  };
}
