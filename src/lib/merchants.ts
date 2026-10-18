import { categoryOf } from "@/categorize/taxonomy";
import { findInDirectory, normalizeAlias } from "@/data-sources/merchant-directory";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { parseMoneyToCents } from "@/lib/money";

// The merchant directory (shared knowledge about companies, never about people): reading
// it for the app, and checking what the team types at /admin/merchants.

export type MerchantInput = {
  name: string;
  key: string;
  aliases: string;
  category: string;
  cancelUrl: string;
  supportUrl: string;
  supportPhone: string;
  supportEmail: string;
  typicalMonthly: string;
  reviewed: boolean;
};

export type MerchantData = {
  key: string;
  name: string;
  aliases: string[];
  category: string | null;
  cancelUrl: string | null;
  supportUrl: string | null;
  supportPhone: string | null;
  supportEmail: string | null;
  typicalMonthlyCents: number | null;
};

const MAX_TEXT = 200;
const MAX_ALIASES = 20;
// Anything shaped like an email address: the directory holds no personal data. The one
// exception is the company's support address (where the action agent writes), in its own
// field, and never at a personal mail service.
const EMAIL = /\S+@\S+\.\S+/;
const SUPPORT_EMAIL = /^[^\s@<>"]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const PERSONAL_MAIL =
  /@(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|me|aol|proton|protonmail)\./i;
const PHONE = /^\+?[\d\s().-]{7,20}$/;

function httpsUrl(value: string): string | null | "invalid" {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : "invalid";
  } catch {
    return "invalid";
  }
}

// Clean values, or a message saying what to fix.
export function validateMerchant(
  input: MerchantInput,
): { ok: true; data: MerchantData } | { ok: false; message: string } {
  const all = [input.name, input.key, input.aliases, input.cancelUrl, input.supportUrl];
  if (all.some((v) => EMAIL.test(v))) {
    return { ok: false, message: "No email addresses: the directory holds no personal data." };
  }
  if (all.some((v) => v.length > MAX_TEXT * MAX_ALIASES)) {
    return { ok: false, message: "That's too long." };
  }
  const name = input.name.trim().slice(0, MAX_TEXT);
  if (!name) return { ok: false, message: "Give the merchant a name." };
  const key = normalizeAlias(input.key.trim() || name);
  if (!key) return { ok: false, message: "The key needs letters or numbers." };

  const aliases = [
    ...new Set(
      input.aliases
        .split(",")
        .map((a) => normalizeAlias(a.trim()))
        .filter((a): a is string => Boolean(a) && a !== key),
    ),
  ].slice(0, MAX_ALIASES);

  const category = input.category.trim() || null;
  if (category && !categoryOf(category)) {
    return { ok: false, message: "Pick a Plaid category from the list, or leave it empty." };
  }
  const cancelUrl = httpsUrl(input.cancelUrl.trim());
  const supportUrl = httpsUrl(input.supportUrl.trim());
  if (cancelUrl === "invalid" || supportUrl === "invalid") {
    return { ok: false, message: "Links must be full https:// addresses." };
  }
  const supportPhone = input.supportPhone.trim() || null;
  if (supportPhone && !PHONE.test(supportPhone)) {
    return { ok: false, message: "That doesn't look like a phone number." };
  }
  const supportEmail = input.supportEmail.trim().toLowerCase() || null;
  if (supportEmail && (!SUPPORT_EMAIL.test(supportEmail) || PERSONAL_MAIL.test(supportEmail))) {
    return {
      ok: false,
      message: "Support email must be the company's own address, like support@company.com.",
    };
  }
  let typicalMonthlyCents: number | null = null;
  if (input.typicalMonthly.trim()) {
    typicalMonthlyCents = parseMoneyToCents(input.typicalMonthly);
    if (typicalMonthlyCents === null || typicalMonthlyCents < 0) {
      return { ok: false, message: "Typical price must be an amount like 15.49." };
    }
  }
  return {
    ok: true,
    data: {
      key,
      name,
      aliases,
      category,
      cancelUrl,
      supportUrl,
      supportPhone,
      supportEmail,
      typicalMonthlyCents,
    },
  };
}

export async function listMerchants({ client = defaultClient }: { client?: PrismaClient } = {}) {
  return client.merchant.findMany({ orderBy: { name: "asc" } });
}

// The directory row for a merchant key, matched the same way detection matches.
export async function merchantFor(
  merchantKey: string | null,
  { client = defaultClient }: { client?: PrismaClient } = {},
) {
  if (!merchantKey) return null;
  const rows = await client.merchant.findMany();
  const match = findInDirectory(merchantKey, rows);
  return match ? (rows.find((r) => r.key === match.key) ?? null) : null;
}
