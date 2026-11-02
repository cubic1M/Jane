import type { TransferRequest } from "../partner";

// What a real money-movement vendor has to offer. A vendor can't hold Jane's one-day undo (Spinwheel
// deletes a request only within about 15 minutes of creating it; Dwolla cancels only while pending),
// so Jane keeps the delay in its own queue (../queue.ts) and calls `send` on the run-on date.

export type PaymentStatus = "pending" | "settled" | "failed" | "reversed";

// A vendor's own id for something of the person's (partner_links). Null when it isn't linked.
export type LinkLookup = (kind: string, ref: string) => string | null;

export class NotLinked extends Error {
  constructor(what: string) {
    super(`Not linked at the partner: ${what}`);
    this.name = "NotLinked";
  }
}

export interface PaymentAdapter {
  readonly name: string;
  // Only inside the permission check. The key makes a retry safe.
  send(
    request: TransferRequest,
    options: { key: string; link: LinkLookup },
  ): Promise<{ partnerRef: string }>;
  cancel(partnerRef: string): Promise<boolean>;
  status(partnerRef: string): Promise<PaymentStatus>;
}
