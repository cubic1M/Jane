import type { PlaidApi } from "plaid";
import {
  HISTORY_COMPLETE,
  REMOVAL_FAILURES_BEFORE_ALERT,
  REPLACE_COMMIT_MARGIN_MS,
  REPLACE_TOTAL_MS,
  REPLACE_WAIT_MS,
  REPLACE_WAIT_STEP_MS,
  REPLACING_STALE_MS,
  STALE_PENDING_DAYS,
  TRANSACTION_DAYS_REQUESTED,
  TWIN_DATE_SLACK_DAYS,
} from "@/config/plaid";
import { categorizeTransactions } from "@/categorize/categorize";
import {
  PlaidDataSource,
  ReadDeadlineError,
  normalizeAccount,
  type PlaidSync,
} from "@/data-sources/plaid/plaid-source";
import {
  SYNCED_KINDS,
  keepsTransactions,
  type NormalizedAccount,
  type NormalizedTransaction,
} from "@/data-sources/types";
import type { PrismaClient } from "@/generated/prisma/client";
import { decrypt, encrypt } from "@/lib/crypto";
import { db as defaultClient } from "@/lib/db";
import { personTransaction, scopedFor } from "@/lib/db-scoped";
import { log } from "@/lib/log";
import { meteredClaude } from "@/lib/claude-budget";
import { safeMetadata } from "@/lib/audit";
import { recordOpsEvent } from "@/lib/ops-alerts";
import { systemDb } from "@/lib/system-db";
import { PlaidRequestError, plaid, plaidCall } from "./client";
import { heldHistory, latestNotes, offerFullHistory, refusalsFor } from "./history";
import {
  LinkingClosedError,
  releaseItemClaim,
  releaseItemSlot,
  reserveItemSlot,
} from "./item-slots";
import { isDemoToken } from "./demo";
import { ITEM_STATUS } from "./sync";
import { touchedIds } from "./hangs-on";
import { LEGACY_PENDING_PREFIX } from "./legacy-pending";

// One tap for the whole history, losing nothing. Plaid's docs: days_requested has no effect on an Item
// that already has Transactions, and update mode can't change it (it only repairs a sign-in, adds
// products or shares accounts: plaid.com/docs/link/update-mode/, read 2026-11-28); the only way to a
// longer history is /item/remove and a new Link (plaid.com/docs/api/products/transactions/, read
// 2026-11-28). So: a new link of the bank asks for TRANSACTION_DAYS_REQUESTED days, and once Plaid
// says its history is complete everything is read in memory, matched to what Jane already holds,
// and moved in ONE database transaction:
//   - each account of the new Item is the same account as one Jane has (type, subtype, last four
//     digits and name all agree, one for one) or nothing happens at all;
//   - the old account rows are kept and pointed at the new Item and its account ids, so their
//     balances, snapshots, categories, tags, shared-charge splits, receipts and "not income" marks stay where they are;
//   - each transaction the new Item has is matched to its twin in the old rows: first the same account,
//     day, amount and words, then (for a charge the new Item words differently or dates a day or two
//     apart) the same account and amount within TWIN_DATE_SLACK_DAYS, one for one, the nearest first; the
//     twin takes the new Plaid id and KEEPS ITS OWN ROW ID, so everything that points at it survives and
//     nothing is counted twice. New rows with no twin are added (the extra history). A posted charge Jane
//     holds is never deleted: if one inside the days the new read returned has no twin, the move refuses
//     before writing anything. Only a stale pending row (STALE_PENDING_DAYS old, nothing of the person's
//     on it, hangs-on.ts) is removed; a younger or touched pending one is kept under a legacy-pending id
//     (legacy-pending.ts).
// The new Item is never only in memory: right after it is made, a hidden row ("replacing") holds its
// encrypted token; the move turns that row into the person's link; any failure removes the Item at
// Plaid and then the row; the nightly job removes a "replacing" row older than REPLACING_STALE_MS.
// Only then is the old Item removed at Plaid. Any failure before that leaves the old link exactly as
// it was and removes the new Item.

export class ReplaceRefused extends Error {
  constructor(
    readonly reason: string,
    // Counts only, for the record.
    readonly counts: Record<string, number> = {},
  ) {
    super(reason);
  }
}

// What the person is told, never a code or a stack.
export const REPLACE_WORDS: Record<string, string> = {
  not_offered: "Jane has nothing more to get from this bank right now.",
  different_bank: "That is a different bank from the one Jane has. Nothing was changed.",
  accounts_differ:
    "The accounts you shared are not the same as the ones Jane already has from this bank, so nothing was changed. Pick the same accounts and try again.",
  not_ready:
    "The bank is slow to send its older history. Nothing was changed; please try again in an hour.",
  busy: "This was already started. Nothing was changed.",
  read_differs:
    "The bank's longer history doesn't line up with what Jane already has, so nothing was changed. Jane has noted it for the team.",
};

type OldAccount = {
  id: string;
  plaidAccountId: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  name: string;
};

const same = (a: string | null, b: string | null) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

const typeOf = (a: NormalizedAccount) => SYNCED_KINDS[a.kind].type;
const subtypeOf = (a: NormalizedAccount) => a.plaidSubtype ?? SYNCED_KINDS[a.kind].subtype;

// Plaid's new account ref for each old account id, or a refusal. One for one: every old account has
// exactly one match and every new account is matched, on type, subtype, last four digits (or none on
// both) and name. Any account that fits two, or none, is a doubt.
export function matchAccounts(
  old: readonly OldAccount[],
  incoming: readonly NormalizedAccount[],
): Map<string, string> {
  if (old.length === 0 || old.length !== incoming.length)
    throw new ReplaceRefused("accounts_differ");
  const fits = (o: OldAccount, n: NormalizedAccount) =>
    o.type === typeOf(n) &&
    same(o.subtype, subtypeOf(n)) &&
    same(o.mask, n.mask) &&
    same(o.name, n.name);
  const out = new Map<string, string>();
  const taken = new Set<string>();
  for (const o of old) {
    const options = incoming.filter((n) => fits(o, n));
    if (options.length !== 1 || taken.has(options[0].ref))
      throw new ReplaceRefused("accounts_differ");
    taken.add(options[0].ref);
    out.set(o.id, options[0].ref);
  }
  return out;
}

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

type OldRow = {
  id: string;
  accountId: string;
  date: Date;
  amountCents: number;
  description: string;
  categorySource: string | null;
  createdAt: Date;
  pending: boolean;
  // The person has set or hung anything on the row (hangs-on.ts). Unset: only a category they set counts.
  touched?: boolean;
  // Null for a row Plaid did not make (never deleted here).
  plaidTransactionId?: string | null;
};

const isTouched = (r: OldRow) => r.touched ?? r.categorySource === "user";

const keyOf = (accountId: string, day: string, cents: number, description: string) =>
  `${accountId}|${day}|${cents}|${words(description)}`;

// Pairs each new transaction with its twin among the old rows: the same account, day, amount and
// words of the description. Several alike pair one to one, the person's own edited rows first, so a
// set category is never left behind. Returns the old row id for each new transaction id that has a
// twin; the rest of the old rows are left as they are, the rest of the new ones are added.
export function matchTwins(
  oldRows: readonly OldRow[],
  incoming: readonly (NormalizedTransaction & { accountId: string })[],
): Map<string, string> {
  const olds = new Map<string, OldRow[]>();
  for (const r of oldRows) {
    const k = keyOf(r.accountId, r.date.toISOString().slice(0, 10), r.amountCents, r.description);
    olds.set(k, [...(olds.get(k) ?? []), r]);
  }
  for (const list of olds.values()) {
    list.sort(
      (a, b) =>
        Number(isTouched(b)) - Number(isTouched(a)) ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    );
  }
  const byId = new Map(incoming.map((t) => [t.externalId, t]));
  // A posted charge that replaces a pending one (Q's pendingExternalId is P) takes the old row of P:
  // the day or amount may differ, and the person's category on that row must go to Q. P itself is
  // never paired, or the charge would be there twice.
  const superseded = new Set(
    incoming.flatMap((t) =>
      !t.pending && t.pendingExternalId && byId.has(t.pendingExternalId)
        ? [t.pendingExternalId]
        : [],
    ),
  );
  const twins = new Map<string, string>();
  const used = new Set<string>();
  const take = (key: string, onlyPending = false) => {
    const list = olds.get(key);
    const at = list?.findIndex((r) => !onlyPending || r.pending) ?? -1;
    const twin = at >= 0 ? list?.splice(at, 1)[0] : undefined;
    if (twin) used.add(twin.id);
    return twin;
  };
  const ordered = [...incoming]
    .filter((t) => !superseded.has(t.externalId))
    .sort((a, b) => a.externalId.localeCompare(b.externalId));
  const predecessorOf = (t: (typeof incoming)[number]) =>
    !t.pending && t.pendingExternalId ? byId.get(t.pendingExternalId) : undefined;
  // First the posted charges that replace a pending one in this read: they claim the pending rows
  // before any ordinary charge can take them.
  for (const t of ordered) {
    const pending = predecessorOf(t);
    if (!pending) continue;
    const twin =
      take(
        keyOf(pending.accountId, pending.date, pending.amountCents, pending.description),
        true,
      ) ?? take(keyOf(t.accountId, t.date, t.amountCents, t.description));
    if (twin) twins.set(t.externalId, twin.id);
  }
  for (const t of ordered) {
    if (twins.has(t.externalId) || predecessorOf(t)) continue;
    // A pending arrival is only ever the twin of a pending row: a posted charge is not turned back into
    // one (Plaid would later remove the pending id and the row with it).
    const twin = take(keyOf(t.accountId, t.date, t.amountCents, t.description), t.pending === true);
    if (twin) twins.set(t.externalId, twin.id);
  }
  // A posted charge that says it replaced a pending one the read no longer lists (the new link's ids
  // are not the old ones, so only the charge itself says so) takes the nearest old pending row of the
  // same words: a week either side, an amount within a third (a tip). The category goes with it.
  for (const t of ordered) {
    if (twins.has(t.externalId) || t.pending || !t.pendingExternalId) continue;
    const day = Date.parse(`${t.date}T00:00:00Z`);
    const near = oldRows
      .filter(
        (r) =>
          r.pending &&
          !used.has(r.id) &&
          r.accountId === t.accountId &&
          words(r.description) === words(t.description) &&
          Math.abs(Date.parse(r.date.toISOString().slice(0, 10) + "T00:00:00Z") - day) <=
            7 * 86_400_000 &&
          Math.abs(r.amountCents - t.amountCents) <= Math.abs(t.amountCents) / 3,
      )
      .sort(
        (a, b) =>
          Math.abs(a.date.getTime() - day) - Math.abs(b.date.getTime() - day) ||
          a.id.localeCompare(b.id),
      )[0];
    if (near) {
      used.add(near.id);
      twins.set(t.externalId, near.id);
    }
  }
  // What is left: a charge the new Item words differently, or dates a day or two apart, is still the same
  // charge: the same account and amount within TWIN_DATE_SLACK_DAYS, one for one, the nearest first, the
  // person's own rows first among equals. Only old rows no twin has taken, only new rows without a twin.
  const slack = TWIN_DATE_SLACK_DAYS * 86_400_000;
  const byAmount = new Map<string, OldRow[]>();
  for (const r of oldRows) {
    if (used.has(r.id)) continue;
    const k = `${r.accountId}|${r.amountCents}`;
    byAmount.set(k, [...(byAmount.get(k) ?? []), r]);
  }
  const pairs: { t: string; r: OldRow; gap: number }[] = [];
  for (const t of ordered) {
    if (twins.has(t.externalId)) continue;
    const day = Date.parse(`${t.date}T00:00:00Z`);
    for (const r of byAmount.get(`${t.accountId}|${t.amountCents}`) ?? []) {
      const gap = Math.abs(r.date.getTime() - day);
      if (t.pending && !r.pending) continue;
      if (gap <= slack) pairs.push({ t: t.externalId, r, gap });
    }
  }
  pairs.sort(
    (a, b) =>
      a.gap - b.gap ||
      Number(isTouched(b.r)) - Number(isTouched(a.r)) ||
      a.t.localeCompare(b.t) ||
      a.r.id.localeCompare(b.r.id),
  );
  for (const p of pairs) {
    if (twins.has(p.t) || used.has(p.r.id)) continue;
    twins.set(p.t, p.r.id);
    used.add(p.r.id);
  }
  return twins;
}

// What becomes of each old row no new charge is the twin of. `firstDay` is, for each account, the first
// day the new read has a charge on: its window runs from there to today, and the new read is the truth
// for that window.
//   - a row older than that day, or after the last one, or on an account the read has nothing for: kept;
//   - a pending row: kept under a legacy-pending id when it is younger than STALE_PENDING_DAYS or the
//     person touched it (the new link may list it yet; its posted charge finds it again), else dropped;
//   - a posted row inside the window: NEVER dropped. It is a hole (the new read does not have it): the
//     caller refuses the move.
export function planLeftovers(
  oldRows: readonly OldRow[],
  twinned: ReadonlySet<string>,
  firstDay: ReadonlyMap<string, string>,
  now: Date,
  lastDay: ReadonlyMap<string, string> = new Map(),
): { drop: string[]; ghost: string[]; keep: string[]; holes: string[] } {
  const out = {
    drop: [] as string[],
    ghost: [] as string[],
    keep: [] as string[],
    holes: [] as string[],
  };
  const youngAfter = now.getTime() - STALE_PENDING_DAYS * 86_400_000;
  for (const r of oldRows) {
    if (twinned.has(r.id)) continue;
    if (r.pending) {
      if (isTouched(r) || r.date.getTime() > youngAfter) out.ghost.push(r.id);
      else out.drop.push(r.id);
      continue;
    }
    const start = firstDay.get(r.accountId);
    const day = r.date.toISOString().slice(0, 10);
    // Only the days the new read reaches: a row after its last charge is not something it has judged.
    const end = lastDay.get(r.accountId);
    const inside = start !== undefined && day >= start && (end === undefined || day <= end);
    if (inside) out.holes.push(r.id);
    else out.keep.push(r.id);
  }
  return out;
}

// The most of a night the clean-up of replaced links may take (the rest wait for the next run).
const LEFTOVER_BUDGET_MS = 30_000;

type Options = { client?: PrismaClient; api?: PlaidApi; sleep?: (ms: number) => Promise<void> };

export type ReplaceResult = {
  itemId: string;
  accounts: number;
  twins: number;
  added: number;
  // Old rows with no twin that were removed (from Plaid, nothing of the person's on them).
  dropped: number;
  kept: number;
  oldRemoved: boolean;
};

const WHY = "Replacing a bank link: the audit log is the system's record";

async function note(client: PrismaClient, event: string, targetId: string, data: object) {
  await systemDb(WHY, client)
    .auditLog.create({
      data: {
        actorType: "system",
        event,
        targetType: "plaid_item",
        targetId,
        metadata: safeMetadata(data as Record<string, string | number | boolean | null>),
      },
    })
    .catch((error: unknown) =>
      log.error("Couldn't record a bank link replacement", { error: String(error) }),
    );
}

// The new Item is made at Plaid from Link's public token, under a slot like any other new bank.
async function exchange(userId: string, publicToken: string, client: PrismaClient, api: PlaidApi) {
  const slot = await reserveItemSlot(userId, { client });
  try {
    const data = await plaidCall(api.itemPublicTokenExchange({ public_token: publicToken }));
    return { accessToken: data.access_token, plaidItemId: data.item_id, slot };
  } catch (error) {
    const noToken =
      error instanceof PlaidRequestError &&
      error.status !== null &&
      error.status >= 400 &&
      error.status < 500;
    if (slot) {
      if (noToken) await releaseItemSlot(slot, { client }).catch(() => undefined);
      else await releaseItemClaim(slot, { client }).catch(() => undefined);
    }
    throw error;
  }
}

// Waits for Plaid to call the new Item's history complete, reading it in memory from an empty cursor.
async function readComplete(
  api: PlaidApi,
  accessToken: string,
  sleep: (ms: number) => Promise<void>,
): Promise<PlaidSync> {
  const deadline = Date.now() + REPLACE_WAIT_MS;
  for (;;) {
    // The deadline is checked before every page of a read, not only between reads.
    const read = await new PlaidDataSource(api, accessToken, null, undefined, deadline)
      .load()
      .catch((error: unknown) => {
        if (error instanceof ReadDeadlineError) throw new ReplaceRefused("not_ready");
        throw error;
      });
    if (read.updateStatus === HISTORY_COMPLETE && !read.notReady) return read;
    if (Date.now() + REPLACE_WAIT_STEP_MS > deadline) throw new ReplaceRefused("not_ready");
    await sleep(REPLACE_WAIT_STEP_MS);
  }
}

// Replaces one of the person's bank links by a new link of the same bank asking for the longest
// history, as described above. Throws ReplaceRefused (old link untouched, new one removed) or the
// error that stopped it (the same).
export async function replaceWithFullHistory(
  userId: string,
  oldItemId: string,
  publicToken: string,
  institutionName: string | null,
  {
    client = defaultClient,
    api: given,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  }: Options = {},
  now: Date = new Date(),
): Promise<ReplaceResult> {
  const api = given ?? (await plaid());
  const db = scopedFor(userId, client);
  const old = await db.plaidItems.findFirst({
    where: { id: oldItemId, status: "active" },
    select: {
      id: true,
      accessTokenEncrypted: true,
      institutionName: true,
      createdAt: true,
      liabilities: true,
      investments: true,
      accounts: {
        select: {
          id: true,
          plaidAccountId: true,
          type: true,
          subtype: true,
          mask: true,
          name: true,
        },
      },
    },
  });
  if (!old) throw new ReplaceRefused("not_offered");
  const oldToken = decrypt(old.accessTokenEncrypted);
  if (isDemoToken(oldToken)) throw new ReplaceRefused("not_offered");
  // The tap is only on offer when Plaid says the history is complete, the link was read again from the
  // start, and it still holds less than asked: asked again here, not trusted from the page.
  const [held, notes, refusals] = await Promise.all([
    heldHistory(db, old.id),
    latestNotes([old.id], { client }),
    refusalsFor([old.id], { client }),
  ]);
  const last = notes.get(old.id);
  if (
    !offerFullHistory({
      held,
      status: last?.status ?? null,
      linkedAt: old.createdAt,
      rescannedAt: last?.rescannedAt ?? null,
      now,
      // Server-side: after a refusal the tap waits, so a retap cannot make another billed Item.
      refusedAt: refusals.get(old.id) ?? null,
    })
  ) {
    throw new ReplaceRefused("not_offered");
  }
  if (old.institutionName && institutionName && !same(old.institutionName, institutionName)) {
    throw new ReplaceRefused("different_bank");
  }

  const started = Date.now();
  let made: Awaited<ReturnType<typeof exchange>>;
  try {
    made = await exchange(userId, publicToken, client, api);
  } catch (error) {
    if (error instanceof LinkingClosedError) throw error;
    throw error;
  }
  const removeNewAtPlaid = async () => {
    try {
      await plaidCall(api.itemRemove({ access_token: made.accessToken }));
      return true;
    } catch (error) {
      if (isGone(error)) return true;
      log.error("Couldn't remove a bank link that replaced nothing", { error: String(error) });
      return false;
    }
  };
  // From here the new Item exists at Plaid and is never only in memory: a hidden row holds its encrypted
  // token, in its own small transaction, before anything else is done. A function that is killed
  // (a deploy, a time limit) leaves that row, and the nightly job removes the Item at Plaid.
  let holdId: string;
  try {
    holdId = (
      await personTransaction(
        userId,
        (tx) =>
          tx.plaidItem.create({
            data: {
              userId,
              plaidItemId: made.plaidItemId,
              accessTokenEncrypted: encrypt(made.accessToken),
              institutionName: old.institutionName ?? institutionName,
              status: ITEM_STATUS.replacing,
            },
            select: { id: true },
          }),
        client,
      )
    ).id;
  } catch (error) {
    // Nowhere to keep it: take it off Plaid at once.
    await removeNewAtPlaid();
    if (made.slot) await releaseItemClaim(made.slot, { client }).catch(() => undefined);
    throw error;
  }
  // Whatever goes wrong from here, the new Item is removed at Plaid and then its row; if Plaid will not
  // remove it now, the row becomes "replaced" and the nightly job tries again, whatever its age.
  const undoNew = async () => {
    const gone = await removeNewAtPlaid();
    await personTransaction(
      userId,
      async (tx) => {
        if (gone) {
          await tx.plaidItem.deleteMany({
            where: {
              id: holdId,
              userId,
              status: { in: [ITEM_STATUS.replacing, ITEM_STATUS.replaced] },
            },
          });
        } else {
          await tx.plaidItem.updateMany({
            where: { id: holdId, userId, status: ITEM_STATUS.replacing },
            data: { status: ITEM_STATUS.replaced },
          });
        }
      },
      client,
    ).catch((saveError: unknown) =>
      log.error("Couldn't update a bank link that is still to be removed", {
        error: String(saveError),
      }),
    );
    if (made.slot) await releaseItemClaim(made.slot, { client }).catch(() => undefined);
  };
  const overBudget = () => {
    if (Date.now() - started > REPLACE_TOTAL_MS) throw new ReplaceRefused("not_ready");
  };

  let result: Omit<ReplaceResult, "oldRemoved"> & { newRowId: string };
  try {
    // The bank is checked at Plaid, not on the word of the page: both Items must name the same institution.
    const [was, now0] = await Promise.all([
      plaidCall(api.itemGet({ access_token: oldToken })),
      plaidCall(api.itemGet({ access_token: made.accessToken })),
    ]);
    const bank = was.item.institution_id;
    if (!bank || bank !== now0.item.institution_id) throw new ReplaceRefused("different_bank");
    const read = await readComplete(api, made.accessToken, sleep);
    overBudget();
    const list = await plaidCall(api.accountsGet({ access_token: made.accessToken }));
    const incoming = list.accounts
      .map(normalizeAccount)
      .filter((a): a is NormalizedAccount => a !== null);
    const accountFor = matchAccounts(old.accounts, incoming);
    const byRef = new Map([...accountFor].map(([oldId, ref]) => [ref, oldId] as const));
    const bankRefs = new Set(incoming.filter((a) => keepsTransactions(a.kind)).map((a) => a.ref));

    // Only the transactions of accounts that keep them; everything else the sync does on its own.
    const incomingTx = read.transactions
      .filter((t) => bankRefs.has(t.accountRef) && byRef.has(t.accountRef))
      .map((t) => ({ ...t, accountId: byRef.get(t.accountRef)! }));
    const held = await db.transactions.findMany({
      where: { accountId: { in: old.accounts.map((a) => a.id) }, source: "plaid" },
      select: {
        id: true,
        accountId: true,
        date: true,
        amountCents: true,
        description: true,
        categorySource: true,
        incomePlacement: true,
        plaidTransactionId: true,
        createdAt: true,
        pending: true,
      },
    });
    // Which of them the person has set or hung anything on (a category, a "not income" mark, a tax tag, a
    // receipt, a sudden-money record, a goal transfer, a shared charge): see hangs-on.ts.
    const touched = await personTransaction(
      userId,
      (tx) => touchedIds(tx, userId, held, client),
      client,
    );
    const oldRows = held.map((r) => ({ ...r, touched: touched.has(r.id) }));
    const twins = matchTwins(oldRows, incomingTx);
    const twinned = new Set(twins.values());
    // The first day the new read has a charge on, for each account: the window it is the truth for.
    const firstDay = new Map<string, string>();
    const lastDay = new Map<string, string>();
    for (const t of incomingTx) {
      const was = firstDay.get(t.accountId);
      if (was === undefined || t.date < was) firstDay.set(t.accountId, t.date);
      const last = lastDay.get(t.accountId);
      if (last === undefined || t.date > last) lastDay.set(t.accountId, t.date);
    }
    const left = planLeftovers(oldRows, twinned, firstDay, now, lastDay);
    if (left.holes.length > 0) {
      // A charge Jane holds that the new read, in the days it returned, does not have under any twin: a
      // hole or a charge it words very differently. Nothing is deleted on a guess and nothing is written.
      throw new ReplaceRefused("read_differs", { holes: left.holes.length, rows: oldRows.length });
    }
    const byExternal = new Map(incomingTx.map((t) => [t.externalId, t]));
    const twinKeys = [...twins.keys()];
    // A posted charge replaces its pending one: never both.
    const replacedPending = new Set(
      incomingTx.flatMap((t) => (t.pendingExternalId && !t.pending ? [t.pendingExternalId] : [])),
    );
    const fresh = incomingTx.filter(
      (t) => !twins.has(t.externalId) && !replacedPending.has(t.externalId),
    );
    // Categories for the new rows, outside the database transaction (it may ask Claude).
    overBudget();
    // Within what is left of the budget (the commit and the removal at Plaid keep their margin). Past it
    // the new rows are saved with Plaid's own category and no category source, which the sync's ordinary
    // categorizer picks up later; the answer from Claude is not waited for.
    const remaining = REPLACE_TOTAL_MS - REPLACE_COMMIT_MARGIN_MS - (Date.now() - started);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const categorized = await Promise.race([
      categorizeTransactions(fresh, db, { claude: meteredClaude(userId) }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), Math.max(remaining, 0));
      }),
    ]).finally(() => clearTimeout(timer));
    const rows = categorized ?? fresh.map((t) => ({ ...t, category: null, categorySource: null }));
    overBudget();

    let moved: { id: string; dropped: number };
    try {
      moved = await personTransaction(
        userId,
        async (tx) => {
          // Claim the old link: a second tap, or a webhook, finds it no longer active. This takes the link's
          // row lock, which every write of a sync of that link holds (shared) while it writes: the move
          // waits for a sync that is saving, and a sync that comes after finds the link replaced.
          const claimed = await tx.plaidItem.updateMany({
            where: { id: old.id, userId, status: "active" },
            data: { status: "replaced", transactionsCursor: null },
          });
          if (claimed.count !== 1) throw new ReplaceRefused("busy");
          // The claim may have waited for a sync that was writing: the budget is looked at again.
          overBudget();
          // A sync that saved or removed rows on these accounts since they were read means the match is
          // stale: the SET of ids is compared, not a count (one added and one removed keeps the count).
          const nowHeld = await tx.transaction.findMany({
            where: { accountId: { in: old.accounts.map((a) => a.id) }, source: "plaid", userId },
            select: { id: true, date: true, amountCents: true, pending: true, description: true },
          });
          // The ids, and what the matching used of each (day, amount, pending): a row a sync corrected
          // in place is as stale as one it added or removed.
          const seen = new Map(oldRows.map((r) => [r.id, r]));
          if (
            nowHeld.length !== seen.size ||
            nowHeld.some((r) => {
              const was = seen.get(r.id);
              return (
                !was ||
                was.amountCents !== r.amountCents ||
                was.pending !== r.pending ||
                was.description !== r.description ||
                was.date.getTime() !== r.date.getTime()
              );
            })
          ) {
            throw new ReplaceRefused("busy");
          }
          // The hidden row made right after the exchange becomes the person's link.
          const turned = await tx.plaidItem.updateMany({
            where: { id: holdId, userId, status: ITEM_STATUS.replacing },
            data: {
              status: ITEM_STATUS.active,
              institutionName: old.institutionName ?? institutionName,
              liabilities: old.liabilities,
              investments: old.investments,
              transactionsCursor: read.nextCursor || null,
              lastSyncedAt: now,
            },
          });
          // Gone: the nightly job took it (this ran far too long).
          if (turned.count !== 1) throw new ReplaceRefused("busy");
          const row = { id: holdId };
          for (const [oldId, ref] of accountFor) {
            const moved = await tx.account.updateMany({
              where: { id: oldId, userId, itemId: old.id },
              data: { itemId: row.id, plaidAccountId: ref },
            });
            // An account revoked since it was read is not moved: nothing is committed on a doubt.
            if (moved.count !== 1) throw new ReplaceRefused("accounts_differ");
          }
          // Every twin takes its new Plaid id in one statement (a year of history is thousands).
          if (twins.size > 0) {
            const taken = await tx.$executeRaw`
            UPDATE transactions AS t SET plaid_transaction_id = v.pid, pending = v.pending,
              date = v.day, amount_cents = v.cents
            FROM unnest(${[...twins.values()]}::text[], ${twinKeys}::text[], ${twinKeys.map((k) => byExternal.get(k)?.pending === true)}::boolean[], ${twinKeys.map((k) => byExternal.get(k)?.date ?? "")}::date[], ${twinKeys.map((k) => byExternal.get(k)?.amountCents ?? 0)}::int[]) AS v(id, pid, pending, day, cents)
            WHERE t.id = v.id AND t.user_id = ${userId}`;
            if (taken !== twins.size) throw new ReplaceRefused("accounts_differ");
          }
          // Old rows with no twin (planLeftovers). Anything the person touched since it was read is kept.
          let dropped = 0;
          const toLegacy = [...left.ghost];
          if (left.drop.length > 0) {
            // Locked first, so a tag written meanwhile either is seen below or waits for this commit.
            await tx.$queryRaw`SELECT id FROM transactions WHERE user_id = ${userId} AND id = ANY(${left.drop}::text[]) FOR UPDATE`;
            const now0 = await tx.transaction.findMany({
              where: { id: { in: left.drop }, userId },
              select: { id: true, categorySource: true, incomePlacement: true, pending: true },
            });
            const mine = await touchedIds(tx, userId, now0, client);
            // A pending row the person touched after the plan was made is kept like any other kept pending row.
            toLegacy.push(...now0.filter((r) => mine.has(r.id) && r.pending).map((r) => r.id));
            const safe = now0.filter((r) => !mine.has(r.id)).map((r) => r.id);
            dropped = (await tx.transaction.deleteMany({ where: { id: { in: safe }, userId } }))
              .count;
          }
          // A pending row kept: under its own legacy id, so no new id of the new link can collide with it.
          if (toLegacy.length > 0) {
            await tx.$executeRaw`
            UPDATE transactions SET plaid_transaction_id = ${LEGACY_PENDING_PREFIX} || plaid_transaction_id
            WHERE user_id = ${userId} AND id = ANY(${toLegacy}::text[])
              AND plaid_transaction_id IS NOT NULL
              AND plaid_transaction_id NOT LIKE ${LEGACY_PENDING_PREFIX + "%"}`;
          }
          await tx.transaction.createMany({
            data: rows.map((t) => ({
              userId,
              source: "plaid" as const,
              plaidTransactionId: t.externalId,
              accountId: t.accountId,
              date: new Date(`${t.date}T00:00:00Z`),
              amountCents: t.amountCents,
              description: t.description,
              merchantName: t.merchantName,
              pfcPrimary: t.category?.primary ?? null,
              pfcDetailed: t.category?.detailed ?? null,
              categorySource: t.categorySource,
              pending: t.pending,
            })),
            skipDuplicates: true,
          });
          // Nothing may be left on the old link, or it would be removed with its rows.
          const stillOn = await tx.account.count({ where: { itemId: old.id, userId } });
          if (stillOn !== 0) throw new ReplaceRefused("accounts_differ");
          return { id: row.id, dropped };
        },
        client,
      );
    } catch (error) {
      // The answer to the commit can be lost after the database has committed: the new link then already
      // holds the accounts and is the person's link. Read it back before anything is removed; if the read
      // fails too, nothing is removed now (a link still "replacing" is taken by the nightly job later).
      const held = await movedAlready(userId, holdId, accountFor.size, client);
      if (held === null) throw new HeldForLater(error);
      if (!held) throw error;
      log.warn("A bank link replacement committed but its answer was lost; finishing it");
      moved = { id: holdId, dropped: left.drop.length };
    }
    const newRowId = moved.id;
    result = {
      itemId: newRowId,
      newRowId,
      accounts: accountFor.size,
      twins: twins.size,
      added: rows.length,
      dropped: moved.dropped,
      kept: oldRows.length - twins.size - moved.dropped,
    };
  } catch (error) {
    // The state of the move is unknown (the answer to its commit was lost and the read back failed):
    // the new link stays as it is, and the nightly job removes it if it is still only "replacing".
    if (error instanceof HeldForLater) throw error.cause;
    // A refusal after the new Item was made is recorded (a reason code and counts, nothing else).
    if (error instanceof ReplaceRefused) await recordRefusal(userId, old.id, client, error);
    await undoNew();
    throw error;
  }

  // The old Item goes at Plaid so it is not billed twice and cannot sync again. If that fails the
  // old row stays as "replaced" (no accounts, never synced, hidden) and the nightly job tries again.
  // It has committed: a failure here only leaves the old link to the nightly job.
  const oldRemoved = await removeReplaced(userId, old.id, client, api).catch((error: unknown) => {
    log.error("Cleaning up a replaced bank link failed", { error: String(error) });
    return false;
  });
  await note(client, "plaid_history_replaced", result.newRowId, {
    accounts: result.accounts,
    twins: result.twins,
    added: result.added,
    dropped: result.dropped,
    kept: result.kept,
    oldRemoved,
    daysRequested: TRANSACTION_DAYS_REQUESTED,
  });
  return { ...result, oldRemoved };
}

const isGone = (error: unknown) =>
  error instanceof PlaidRequestError &&
  (error.code === "ITEM_NOT_FOUND" || error.code === "INVALID_ACCESS_TOKEN");

class HeldForLater extends Error {
  constructor(readonly cause: unknown) {
    super("held for the nightly job");
  }
}

// Whether the move did commit: the hidden row is the person's link and holds all their accounts. Null when
// that cannot be read.
async function movedAlready(
  userId: string,
  holdId: string,
  accounts: number,
  client: PrismaClient,
): Promise<boolean | null> {
  try {
    const db = scopedFor(userId, client);
    const [row, held] = await Promise.all([
      db.plaidItems.findFirst({
        where: { id: holdId, status: ITEM_STATUS.active },
        select: { id: true },
      }),
      db.accounts.count({ where: { itemId: holdId } }),
    ]);
    return row !== null && held === accounts;
  } catch {
    return null;
  }
}

// The team's record of a refusal: an audit row and an ops event, a reason code and counts only.
async function recordRefusal(
  userId: string,
  oldItemId: string,
  client: PrismaClient,
  error: ReplaceRefused,
) {
  await note(client, "plaid_history_refused", oldItemId, { reason: error.reason, ...error.counts });
  await recordOpsEvent("plaid_history_refused", {
    code: error.reason.toUpperCase(),
    userId,
    client,
  });
}

// Takes a replaced link (or a "replacing" one the move never reached) off Plaid and out of the database.
// True when it is gone.
export async function removeReplaced(
  userId: string,
  oldItemId: string,
  client: PrismaClient,
  api: PlaidApi,
  status: "replaced" | "replacing" = "replaced",
): Promise<boolean> {
  const db = scopedFor(userId, client);
  const row = await db.plaidItems.findFirst({
    where: { id: oldItemId, status },
    select: { id: true, accessTokenEncrypted: true, lastErrorCode: true },
  });
  if (!row) return true;
  try {
    await plaidCall(api.itemRemove({ access_token: decrypt(row.accessTokenEncrypted) }));
  } catch (error) {
    if (!isGone(error)) {
      log.error("Couldn't remove a replaced bank link at Plaid", { error: String(error) });
      // The nights it has failed, kept on the hidden row (it is never shown): after a few the team is told,
      // for a billed Item that nobody can see.
      // STUCK once the team has been told (the event was recorded), FAILED until then, so an alert that
      // could not be recorded (an hourly limit, a write failure) is tried again the next night.
      const was = /^REMOVAL_(FAILED|STUCK)_(\d+)$/.exec(row.lastErrorCode ?? "");
      const failed = Number(was?.[2] ?? 0) + 1;
      let told = was?.[1] === "STUCK";
      if (!told && failed >= REMOVAL_FAILURES_BEFORE_ALERT) {
        told = (
          await recordOpsEvent("plaid_removal_stuck", { code: `NIGHTS_${failed}`, userId, client })
        ).recorded;
      }
      await db.plaidItems
        .updateMany({
          where: { id: row.id, status },
          data: {
            lastErrorCode: `REMOVAL_${told ? "STUCK" : "FAILED"}_${failed}`,
            lastErrorAt: new Date(),
          },
        })
        .catch(() => undefined);
      return false;
    }
  }
  // Only a row with no accounts left: the cascade must never reach one.
  if ((await db.accounts.count({ where: { itemId: row.id } })) > 0) return false;
  await db.plaidItems.deleteMany({ where: { id: row.id, status } });
  return true;
}

// The nightly job: replaced links whose removal at Plaid failed are tried again.
export async function removeLeftoverReplaced({
  client = defaultClient,
  api: given,
  budgetMs = LEFTOVER_BUDGET_MS,
  userIds,
}: {
  client?: PrismaClient;
  api?: PlaidApi;
  budgetMs?: number;
  // Tests only: these people's links (the test database is shared).
  userIds?: readonly string[];
} = {}): Promise<number> {
  const stop = Date.now() + budgetMs;
  // A "replacing" link is one a replacement made and has not moved in yet: only one older than
  // REPLACING_STALE_MS is the leftover of a function that was killed; a younger one belongs to a
  // replacement still running and is left alone.
  const rows = await systemDb(
    "Cron: replaced bank links still to remove at Plaid",
    client,
  ).plaidItem.findMany({
    where: {
      ...(userIds ? { userId: { in: [...userIds] } } : {}),
      OR: [
        { status: "replaced" },
        { status: "replacing", createdAt: { lt: new Date(Date.now() - REPLACING_STALE_MS) } },
      ],
    },
    select: { id: true, userId: true, status: true },
    take: 25,
  });
  if (rows.length === 0) return 0;
  const api = given ?? (await plaid());
  let removed = 0;
  for (const r of rows) {
    // The rest wait for tomorrow: the banks and the later steps of the night need the time.
    if (Date.now() >= stop) break;
    if (
      await removeReplaced(
        r.userId,
        r.id,
        client,
        api,
        r.status === "replacing" ? "replacing" : "replaced",
      )
    )
      removed += 1;
  }
  return removed;
}
