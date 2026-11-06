import { createHash } from "node:crypto";
import { formatCents } from "@/lib/money";
import { BadRequest, type ActionDetails } from "../types";

// What the sandbox adapters share. A sandbox adapter simulates a partner: it calls nobody, answers
// the same way for the same request, and only sample-data people ever reach one (whyUnavailable in
// ../registry.ts). Its words say so: nothing real happens.

export const SIMULATED = "Simulated: nothing real was sent.";

// Spinwheel deletes a payment request only within about 15 minutes of making it, and Dwolla cancels
// only while pending (connector-plan.md): the sandbox keeps the shorter of the two.
export const SANDBOX_CANCEL_MINUTES = 15;

export const text = (details: ActionDetails, key: string): string => {
  const value = details[key];
  if (typeof value !== "string" || value.trim() === "") throw new BadRequest(`${key} is missing`);
  return value.trim().slice(0, 120);
};

export const cents = (details: ActionDetails, key: string): number => {
  const value = details[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new BadRequest(`${key} must be a positive whole number of cents`);
  }
  return value;
};

export const dollars = formatCents;

// The partner's id for it: the same request gives the same id, as a partner's idempotency would.
export const sandboxRef = (prefix: string, idempotencyKey: string): string =>
  `${prefix}_${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 24)}`;

export const cancelUntil = (now: Date): Date =>
  new Date(now.getTime() + SANDBOX_CANCEL_MINUTES * 60 * 1000);
