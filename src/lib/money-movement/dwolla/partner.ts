import { randomUUID } from "node:crypto";
import { DWOLLA_SANDBOX } from "@/config/money-movement";
import type { MoneyMovementPartner, TransferRequest } from "../partner";
import { dwollaSandboxHttp, type DwollaApi } from "./api";

// Dwolla's Sandbox as Jane's money-movement partner (batch-2 connectors): fake money between the
// person's own accounts (Dwolla's "me-to-me"), for building against. Never real money: only the
// Sandbox host exists here, REAL_MONEY_MOVEMENT stays false, and moneyPartnerFor never returns it,
// so nobody's transfers reach it; tests and a founder's Sandbox run hand it in as `partner`.
//
// The one-day undo stays in Jane's queue: scheduling sends Dwolla nothing, and undoing a queued
// transfer is Jane's alone. Only on its day (settleTransfers) is it released to Dwolla, with its
// queue ref as the Idempotency-Key and correlationId, so a retried release never makes a second
// one. Once released, an undo asks Dwolla to cancel and fails if Dwolla says processing began.
//
// Which Dwolla funding source is which of the person's accounts isn't built: it needs a Dwolla
// Verified Customer (their identity) and each bank verified. `fundingSource` says it per account.

const QUEUED = "JANEQ-";
const SENT = "dwolla:";

type Options = {
  // The Dwolla Sandbox funding-source href for one of the person's accounts, or null.
  fundingSource: (accountId: string) => string | null;
  api?: DwollaApi;
};

export function dwollaSandboxPartner({
  fundingSource,
  api = dwollaSandboxHttp(),
}: Options): MoneyMovementPartner {
  const hrefs = (request: Pick<TransferRequest, "fromAccountId" | "toAccountId">) => {
    const source = fundingSource(request.fromAccountId);
    const destination = request.toAccountId ? fundingSource(request.toAccountId) : null;
    if (!source || !destination) {
      throw new Error("Dwolla's Sandbox only moves money between your own linked accounts.");
    }
    return { source, destination };
  };

  return {
    name: DWOLLA_SANDBOX.name,
    simulated: true,
    async schedule(request) {
      // Checked now, so a transfer that could never be released isn't queued.
      hrefs(request);
      return { partnerRef: `${QUEUED}${randomUUID()}` };
    },
    async release(partnerRef, request) {
      if (!partnerRef.startsWith(QUEUED)) return { partnerRef };
      const { source, destination } = hrefs(request);
      const id = await api.createTransfer({
        sourceHref: source,
        destinationHref: destination,
        amountCents: request.amountCents,
        correlationId: partnerRef,
        idempotencyKey: partnerRef,
      });
      return { partnerRef: `${SENT}${id}` };
    },
    async cancel(partnerRef) {
      if (partnerRef.startsWith(QUEUED)) return true;
      if (!partnerRef.startsWith(SENT)) return false;
      return api.cancelTransfer(partnerRef.slice(SENT.length));
    },
    async settled({ partnerRef }) {
      if (!partnerRef?.startsWith(SENT)) return false;
      return (await api.transferStatus(partnerRef.slice(SENT.length))) === "processed";
    },
  };
}
