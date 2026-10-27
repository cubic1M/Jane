import type { ActionType, PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { replyAddress } from "./mail";
import { rollOf } from "@/lib/hash";

// A stand-in for a company's support inbox, used when real agent email isn't set up and
// never in production (src/lib/agent/mail.ts). It answers like a support team would, so
// the agent's whole loop (send, read the reply, act, follow up, ask the person) runs in
// development and tests. Each action gets the same kind of answer every time.

const SIMULATED_DOMAIN = "simulated-support.example";

export function simulatedAddress(merchant: string): string {
  const slug =
    merchant
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "company";
  return `support@${slug}.${SIMULATED_DOMAIN}`;
}

export const isSimulatedAddress = (address: string) => address.endsWith(`.${SIMULATED_DOMAIN}`);

export type SimulatedKind = "done" | "needs_info" | "refused" | "needs_person";

// Most requests succeed; some need a detail, a few are refused or need the person.
export function simulatedKind(actionId: string, messagesSoFar: number): SimulatedKind {
  // After the person answers a question, the company goes ahead.
  if (messagesSoFar > 1) return "done";
  const n = rollOf(actionId);
  return n < 6 ? "done" : n < 8 ? "needs_info" : n < 9 ? "refused" : "needs_person";
}

// What the request was about, so the answer fits it: cancelling, a price, or money back.
const CANCEL: readonly ActionType[] = ["cancel_subscription"];
const PRICE: readonly ActionType[] = ["fight_price_increase", "negotiate_bill", "card_interest"];

export function simulatedBody(
  kind: SimulatedKind,
  actionType: ActionType,
  merchant: string,
): string {
  const sign = `\n\nBest,\n${merchant} Support`;
  const cancel = CANCEL.includes(actionType);
  const price = PRICE.includes(actionType);
  switch (kind) {
    case "done":
      return cancel
        ? `Hi,\n\nThanks for reaching out. We've cancelled the subscription, and there will be no further charges.${sign}`
        : actionType === "fight_price_increase"
          ? `Hi,\n\nThanks for being a loyal customer. We can keep your previous price for the next 12 months; the change has been applied to the account.${sign}`
          : price
            ? `Hi,\n\nThanks for being a loyal customer. We've applied a lower rate to the account for the next 12 months.${sign}`
            : `Hi,\n\nThanks for reaching out. Your refund has been processed for the charges listed. It should appear on the card in 5 to 7 business days.${sign}`;
    case "needs_info":
      return `Hi,\n\nHappy to look into this. Could you confirm the last 4 digits of the card that was charged, so we can find the account?${sign}`;
    case "refused":
      return cancel
        ? `Hi,\n\nWe looked into this. Unfortunately we are unable to cancel the subscription on a request sent on the customer's behalf.${sign}`
        : price
          ? `Hi,\n\nWe looked into this. Unfortunately we are unable to change the price on this plan.${sign}`
          : `Hi,\n\nWe looked into this. Unfortunately we are unable to offer a refund for these charges under our terms.${sign}`;
    case "needs_person":
      return `Hi,\n\nFor security, the account holder must contact us directly from the email address on the account.${sign}`;
  }
}

// The job: writes the simulated company's answer to the action's latest message.
export async function simulatedReply(
  userId: string,
  actionId: string,
  {
    client = defaultClient,
    deliver,
  }: {
    client?: PrismaClient;
    deliver: (
      toAddress: string,
      mail: { from: string; subject: string; body: string },
    ) => Promise<unknown>;
  },
): Promise<void> {
  const action = await scopedFor(userId, client).actions.findFirst({
    where: { id: actionId },
    select: {
      id: true,
      type: true,
      decision: { select: { finding: { select: { evidence: true } } } },
      agentMessages: {
        where: { direction: "outbound" },
        orderBy: { createdAt: "desc" },
        select: { toAddress: true, fromAddress: true, subject: true },
      },
    },
  });
  const latest = action?.agentMessages[0];
  if (!action || !latest || !isSimulatedAddress(latest.toAddress)) return;
  const merchant = String(
    (action.decision.finding.evidence as { merchant?: unknown } | null)?.merchant ?? "The company",
  );
  const kind = simulatedKind(action.id, action.agentMessages.length);
  const replyTo = await client.action.findUnique({
    where: { id: action.id },
    select: { replyToken: true },
  });
  await deliver(replyAddress(replyTo?.replyToken ?? ""), {
    from: latest.toAddress,
    subject: latest.subject.startsWith("Re: ") ? latest.subject : `Re: ${latest.subject}`,
    body: simulatedBody(kind, action.type, merchant),
  });
}
