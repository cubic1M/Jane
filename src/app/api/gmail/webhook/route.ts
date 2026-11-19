import { after, NextResponse } from "next/server";
import { GMAIL_LIMITS, gmailOffered, gmailOpen } from "@/config/gmail";
import { mailboxAddress } from "@/lib/gmail/api";
import { syncFromNotice } from "@/lib/gmail/sync";
import { verifyGmailWebhook } from "@/lib/gmail/webhook-verify";
import { log } from "@/lib/log";
import { recordOpsEvent } from "@/lib/ops-alerts";
import { freshSwitches } from "@/lib/ops-switches";
import { cappedText } from "@/lib/robinhood/capped";

// Google's notices that mail reached a connected Gmail mailbox, by Pub/Sub push (docs/setup/gmail.md).
// Nothing is parsed or looked up until Google's signed token for Jane's subscription is verified. A
// notice names a mailbox and nothing else, and is only a hint: the read starts from the place Jane
// saved, so a notice sent again, or one whose body someone else wrote, can at most cause a read.
// Once verified, every notice is acknowledged, whatever it says, because Google would only send
// again what Jane can't use. The read runs after the answer, so Google isn't kept waiting, in what
// is left of GMAIL_LIMITS.runBudgetMs since the notice arrived (routes.integration.test.ts in
// src/lib/gmail adds up the most it can take).
export const maxDuration = 300;

const fieldsOf = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const received = () => NextResponse.json({ received: true });

// The mailbox a notice names, or null when the body isn't one: Pub/Sub's envelope holds Gmail's JSON
// in base64, in either alphabet, and only its address is used, by the rule every mailbox's address
// was saved by (mailboxAddress), so a notice can name any of them.
function addressIn(body: string): string | null {
  let envelope: unknown;
  let notice: unknown;
  try {
    envelope = JSON.parse(body);
    const { data } = fieldsOf(fieldsOf(envelope).message);
    if (typeof data !== "string") return null;
    notice = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
  } catch {
    return null;
  }
  return mailboxAddress(fieldsOf(notice).emailAddress);
}

export async function POST(request: Request) {
  // One deadline for everything this notice starts: what the answer spent comes out of the read's.
  const startedAt = Date.now();
  if (!gmailOffered()) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // 1. Size: what the sender says, then what arrived, read no further than the limit.
  const tooLarge = () => NextResponse.json({ error: "Too large" }, { status: 413 });
  if (Number(request.headers.get("content-length") ?? 0) > GMAIL_LIMITS.webhookBytes) {
    return tooLarge();
  }
  const body = await cappedText(new Response(request.body), GMAIL_LIMITS.webhookBytes);
  if (body === null) return tooLarge();

  // 2. Google's signed token, verified before anything in the body is read.
  if (!(await verifyGmailWebhook(request.headers.get("authorization")))) {
    // Counted for the daily email: many in a day means verification itself broke.
    await recordOpsEvent("gmail_webhook_unverified");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // 3. A notice Jane can't read is dropped: counted, with nothing of what it said.
  const address = addressIn(body);
  if (!address) {
    log.warn("Gmail notice not understood");
    return received();
  }

  // 4. Paused: acknowledged, and the daily job reads what arrived once reading is back.
  await freshSwitches();
  if (!gmailOpen()) return received();

  // 5. The read, after the answer. An unknown address reads nothing, and is answered the same.
  after(async () => {
    try {
      await syncFromNotice(address, {
        budgetMs: Math.max(0, GMAIL_LIMITS.runBudgetMs - (Date.now() - startedAt)),
      });
    } catch (error) {
      log.error("Gmail read from a notice broke", {
        kind: error instanceof Error ? error.name : typeof error,
      });
    }
  });
  return received();
}
