import { ASSET_KINDS, ASSET_VALUE_STALE_DAYS, MAX_ASSET_CENTS } from "@/config/net-worth";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { parseMoneyToCents } from "@/lib/money";

// Things the person owns (spec step 67): a value they give, with the day, counted in net
// worth. Paired with the mortgage or car loan against it, it shows their equity. Jane
// never estimates a value.

type Options = { client?: PrismaClient; now?: Date };

export type AssetKind = keyof typeof ASSET_KINDS;
export const isAssetKind = (v: unknown): v is AssetKind =>
  typeof v === "string" && Object.hasOwn(ASSET_KINDS, v);

export type AssetInput = {
  kind: string;
  name: string;
  value: string;
  valuedOn: string;
  loanAccountId: string;
};

export class AssetError extends Error {}

type Checked = {
  kind: AssetKind;
  name: string;
  valueCents: number;
  valuedOn: Date;
  loanAccountId: string | null;
};

// Pure: the form's fields, checked.
export function checkAsset(input: AssetInput, today: string): Checked {
  if (!isAssetKind(input.kind)) throw new AssetError("Pick what kind of thing it is.");
  const name = input.name.trim();
  if (!name || name.length > 80) throw new AssetError("Give it a short name, like “Our house”.");
  const valueCents = parseMoneyToCents(input.value);
  if (valueCents === null || valueCents <= 0 || valueCents > MAX_ASSET_CENTS) {
    throw new AssetError("Enter what it's worth, in dollars.");
  }
  const day = input.valuedOn.trim() || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > today) {
    throw new AssetError("The date of the value can't be in the future.");
  }
  return {
    kind: input.kind,
    name,
    valueCents,
    valuedOn: new Date(`${day}T00:00:00Z`),
    loanAccountId: input.loanAccountId.trim() || null,
  };
}

// The loan must be one of the person's own loan accounts.
async function checkLoan(userId: string, loanAccountId: string | null, client: PrismaClient) {
  if (!loanAccountId) return null;
  const loan = await scopedFor(userId, client).accounts.findFirst({
    where: { id: loanAccountId, type: "loan" },
    select: { id: true },
  });
  if (!loan) throw new AssetError("That loan isn't one of your accounts.");
  return loan.id;
}

const todayOf = (now: Date) => now.toISOString().slice(0, 10);

export async function addAsset(
  userId: string,
  input: AssetInput,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<string> {
  const checked = checkAsset(input, todayOf(now));
  const loanAccountId = await checkLoan(userId, checked.loanAccountId, client);
  const row = await scopedFor(userId, client).ownedAssets.create({
    data: { ...checked, loanAccountId, userId },
    select: { id: true },
  });
  await track(userId, "asset_added", { kind: checked.kind, with_loan: loanAccountId !== null });
  return row.id;
}

export async function updateAsset(
  userId: string,
  id: string,
  input: AssetInput,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const checked = checkAsset(input, todayOf(now));
  const loanAccountId = await checkLoan(userId, checked.loanAccountId, client);
  const { count } = await scopedFor(userId, client).ownedAssets.updateMany({
    where: { id },
    data: { ...checked, loanAccountId },
  });
  if (count === 0) throw new AssetError("That isn't one of yours.");
  await track(userId, "asset_updated", { kind: checked.kind });
}

export async function removeAsset(
  userId: string,
  id: string,
  { client = defaultClient }: Options = {},
): Promise<void> {
  const { count } = await scopedFor(userId, client).ownedAssets.deleteMany({ where: { id } });
  if (count === 0) throw new AssetError("That isn't one of yours.");
}

export type AssetLine = {
  id: string;
  kind: AssetKind;
  name: string;
  valueCents: number;
  valuedOn: string;
  stale: boolean;
  loan: { id: string; name: string; balanceCents: number | null } | null;
  // Value minus the loan's balance, when both are known.
  equityCents: number | null;
};

export async function listAssets(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<AssetLine[]> {
  const rows = await scopedFor(userId, client).ownedAssets.findMany({
    select: {
      id: true,
      kind: true,
      name: true,
      valueCents: true,
      valuedOn: true,
      loanAccount: { select: { id: true, name: true, currentBalanceCents: true } },
    },
    orderBy: [{ valueCents: "desc" }, { name: "asc" }],
  });
  const staleBefore = now.getTime() - ASSET_VALUE_STALE_DAYS * 86_400_000;
  return rows.map((r) => {
    const loan = r.loanAccount
      ? {
          id: r.loanAccount.id,
          name: r.loanAccount.name,
          balanceCents: r.loanAccount.currentBalanceCents,
        }
      : null;
    return {
      id: r.id,
      kind: isAssetKind(r.kind) ? r.kind : "other",
      name: r.name,
      valueCents: r.valueCents,
      valuedOn: r.valuedOn.toISOString().slice(0, 10),
      stale: r.valuedOn.getTime() < staleBefore,
      loan,
      equityCents:
        loan?.balanceCents == null ? null : r.valueCents - Math.max(0, loan.balanceCents),
    };
  });
}
