"use server";

import { readInvoiceFor } from "@/lib/jane-agent/invoice-for-charge";
import { requireUser } from "@/lib/session";

// Reading a pasted invoice for a charge (founder 11-24). The text is read in memory by rules and
// never stored or logged: it's the company's words about the person's bill.

export type InvoiceState = { ok: boolean; message: string; lines: string[] } | null;

export async function readInvoice(
  _previous: InvoiceState,
  formData: FormData,
): Promise<InvoiceState> {
  const user = await requireUser();
  const text = formData.get("invoice");
  const charge = formData.get("charge");
  if (typeof text !== "string")
    return { ok: false, message: "Paste the invoice's text first.", lines: [] };
  const answer = await readInvoiceFor(
    user.id,
    text,
    typeof charge === "string" && charge ? charge : null,
  );
  if (!answer.ok) return { ok: false, message: answer.message, lines: [] };
  return { ok: true, message: "", lines: [...answer.charge, ...answer.reading] };
}
