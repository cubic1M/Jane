import { TIMEZONES } from "@/config/digest";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { encrypt } from "@/lib/crypto";
import { inQuietHours } from "@/lib/messaging/quiet-hours";
import { phoneHmac } from "@/lib/messaging/phone";
import { findingOfType } from "./findings";

// People for the texts tests (spec step 78), against a real database.

// A timezone where it's daytime right now, so texts go out at once whenever tests run.
export function daytimeZone(now = new Date()): string {
  const zones = [...TIMEZONES.map((t) => t.id), "Asia/Tokyo", "Asia/Kolkata", "Australia/Sydney"];
  const zone = zones.find((tz) => !inQuietHours(now, tz));
  if (!zone) throw new Error("No daytime timezone found");
  return zone;
}

// A timezone where it's night right now.
export function nightZone(now = new Date()): string {
  const zones = [...TIMEZONES.map((t) => t.id), "Asia/Tokyo", "Asia/Kolkata", "Australia/Sydney"];
  const zone = zones.find((tz) => inQuietHours(now, tz));
  if (!zone) throw new Error("No night timezone found");
  return zone;
}

// No-risk findings (a fee refund, a double charge) and risky ones (a bill call, moving
// idle cash, a subscription to cancel).
export const FINDING_TYPES = [
  "bank_fees",
  "duplicate_charge",
  "bill_negotiation",
  "idle_cash",
  "subscription_review",
] as const;

export async function personWithFindings(
  client: PrismaClient,
  { timezone = daytimeZone() }: { timezone?: string } = {},
): Promise<string> {
  const user = await client.user.create({
    data: { email: `texts-${crypto.randomUUID()}@example.com`, timezone },
  });
  for (const type of FINDING_TYPES) {
    const f = findingOfType(type);
    await client.finding.create({
      data: {
        userId: user.id,
        type: f.type,
        key: `${f.key}-${crypto.randomUUID()}`,
        title: f.title,
        annualSavingsCents: f.annualSavingsCents,
        amountCents: f.amountCents,
        confidence: f.confidence,
        evidence: f.evidence as Prisma.InputJsonObject,
      },
    });
  }
  return user.id;
}

// A random made-up number (any area code, exchange 555), unique enough per test run.
export function fakePhone(): string {
  const area = 200 + Math.floor(Math.random() * 800);
  return `+1${area}555${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;
}

// A verified number, as if the person had entered the code.
export async function verifiedNumber(
  client: PrismaClient,
  userId: string,
  phone = fakePhone(),
): Promise<string> {
  await client.textSetting.create({
    data: {
      userId,
      phoneEncrypted: encrypt(phone),
      phoneHmac: phoneHmac(phone),
      consentAt: new Date(),
      consentVersion: "test",
      verifiedAt: new Date(),
    },
  });
  return phone;
}
