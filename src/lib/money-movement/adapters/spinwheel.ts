import { requireGrant } from "@/lib/permission/gate";
import { NotLinked, type LinkLookup, type PaymentAdapter, type PaymentStatus } from "./types";
import type { TransferRequest } from "../partner";

// Card and loan payments through Spinwheel Pay. **NEVER RUN against Spinwheel's API**: built from its
// docs, read 2026-11-02 (docs.spinwheel.io: create-request-1, get-transaction-list-1,
// delete-payment-request-1, embedded-payments), and tested against a mock. Off: nothing selects it
// while REAL_MONEY_MOVEMENT is false (../partner.ts).
//
// Before any live use, unresolved (connector-plan.md): its docs show the end user as payer, but funds
// go to "an FBO (for benefit of) account dedicated to your funds", which counsel and Spinwheel must
// clear against "money never passes through Jane". `amount`'s units aren't stated (dollars here):
// confirm in the sandbox. Liability payments only: its docs don't mention utilities.

export const SPINWHEEL_SANDBOX = "https://sandbox-api.spinwheel.io";

// A liability at Spinwheel, by the field its allocation names it with.
const DESTINATION_FIELDS: Readonly<Record<string, string>> = {
  credit_card: "creditCardId",
  student_loan: "studentLoanId",
  auto_loan: "autoLoanId",
  home_loan: "homeLoanId",
  personal_loan: "personalLoanId",
};

function destinationOf(request: TransferRequest, link: LinkLookup): Record<string, string> {
  for (const [kind, field] of Object.entries(DESTINATION_FIELDS)) {
    const id = link(kind, request.toName);
    if (id) return { [field]: id };
  }
  throw new NotLinked(`a liability for ${request.toName}`);
}

const STATUS: Readonly<Record<string, PaymentStatus>> = {
  APPLIED: "settled",
  FAILED: "failed",
  CANCELLED: "failed",
  RETURNED: "reversed",
};

export function spinwheelAdapter({
  apiKey,
  fetcher,
  baseUrl = SPINWHEEL_SANDBOX,
}: {
  apiKey: string;
  // Given, never the global fetch: nothing here can reach the network unless a caller means it to.
  fetcher: typeof fetch;
  baseUrl?: string;
}): PaymentAdapter {
  const headers = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
  return {
    name: "spinwheel",
    async send(request, { key, link }) {
      requireGrant("money_movement");
      const userId = link("user", "self");
      const payerId = link("payer", request.fromAccountId);
      if (!userId) throw new NotLinked("the person");
      if (!payerId) throw new NotLinked("the account paying");
      const response = await fetcher(`${baseUrl}/v1/payments/requests`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          userId,
          extRequestId: key,
          amount: request.amountCents / 100,
          payerId,
          requestType: "ONE_TIME",
          settlementSpeed: "STANDARD",
          useOfFunds: {
            allocation: [{ ...destinationOf(request, link), percentage: 100 }],
          },
        }),
      });
      if (!response.ok) throw new Error(`Spinwheel answered ${response.status} to a payment`);
      const body = (await response.json()) as { data?: { requestId?: unknown } };
      if (typeof body.data?.requestId !== "string") throw new Error("Spinwheel gave no request id");
      return { partnerRef: body.data.requestId };
    },
    // Only until it's been scheduled, 15 minutes or less from creation; after that it says no.
    async cancel(partnerRef) {
      const response = await fetcher(
        `${baseUrl}/v1/payments/requests/${encodeURIComponent(partnerRef)}`,
        { method: "DELETE", headers },
      );
      return response.ok;
    },
    async status(partnerRef) {
      const response = await fetcher(
        `${baseUrl}/v1/payments/transactions?requestId=${encodeURIComponent(partnerRef)}`,
        { headers },
      );
      if (!response.ok) throw new Error(`Spinwheel answered ${response.status} to a status check`);
      const body = (await response.json()) as { data?: { status?: unknown }[] };
      const status = body.data?.[0]?.status;
      return (typeof status === "string" && STATUS[status]) || "pending";
    },
  };
}
