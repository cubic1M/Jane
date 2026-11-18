import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { isAccountKind, type AccountKind } from "@/data-sources/types";
import type { PrismaClient } from "@/generated/prisma/client";
import { scopedFor } from "@/lib/db-scoped";
import { finishImport } from "@/lib/import/background";
import { importPositionsFiles } from "@/lib/import/positions";
import { saveUpload } from "@/lib/import/upload";
import { systemDb } from "@/lib/system-db";

// A debugger's walked cell as a person the scenario run can ask (walk-chat-questions.md in the
// manager's notes): the walks have no Claude key, so only the backup's answers were ever checked;
// this asks Claude the same questions over the same data. A cell is a folder with its uploaded
// files and a cell.json saying which account each goes to and the balance typed for it, and any
// brokerage positions downloads uploaded on the investments page. The
// person is built through the real upload path, as the debugger built it, and deleted after the
// run like any check person. Sample data only.

type CellAccount = {
  name: string;
  kind: AccountKind;
  // As typed on the upload form ("1,412.22"); left out when none was typed.
  balance?: string;
  files: string[];
};
type Cell = { accounts: CellAccount[]; positions?: string[] };

// A cell.json, checked: throws saying what is wrong with it.
export function parseCell(json: string, where: string): Cell {
  const raw = JSON.parse(json) as { accounts?: unknown; positions?: unknown };
  if (!Array.isArray(raw.accounts) || raw.accounts.length === 0) {
    throw new Error(`${where}: cell.json needs at least one account.`);
  }
  const accounts = raw.accounts.map((item, i): CellAccount => {
    const a = (item ?? {}) as Partial<CellAccount>;
    const at = `${where}: account ${i + 1}`;
    if (!a.name || typeof a.name !== "string") throw new Error(`${at} needs a name.`);
    if (!isAccountKind(a.kind))
      throw new Error(`${at}: kind is an upload account kind, like checking or credit_card.`);
    if (a.balance !== undefined && typeof a.balance !== "string") {
      throw new Error(`${at}: balance is the text typed, like "1,412.22".`);
    }
    if (
      !Array.isArray(a.files) ||
      a.files.length === 0 ||
      a.files.some((f) => !f || typeof f !== "string")
    ) {
      throw new Error(`${at} needs the files uploaded to it.`);
    }
    return {
      name: a.name,
      kind: a.kind,
      ...(a.balance === undefined ? {} : { balance: a.balance }),
      files: a.files,
    };
  });
  if (raw.positions === undefined) return { accounts };
  if (
    !Array.isArray(raw.positions) ||
    raw.positions.length === 0 ||
    raw.positions.some((f) => !f || typeof f !== "string")
  ) {
    throw new Error(
      `${where}: positions are the positions files uploaded, like ["positions.csv"].`,
    );
  }
  return { accounts, positions: raw.positions as string[] };
}

type Read = (path: string) => string;
const readText: Read = (path) => readFileSync(path, "utf8");

// The cell's person: a new account with its positions files saved as the investments page saves
// them, then each of the cell's accounts uploaded, in order, and each upload finished as the
// background job would finish it (which also refreshes what the holdings feed). Returns its id.
export async function createCellPerson(
  dir: string,
  { client, now, read = readText }: { client: PrismaClient; now: Date; read?: Read },
): Promise<string> {
  const cell = parseCell(read(join(dir, "cell.json")), dir);
  const user = await systemDb(
    "Answer checks make and remove their own throwaway person",
    client,
  ).user.create({
    data: { email: `answer-checks-${crypto.randomUUID()}@example.com` },
  });
  if (cell.positions) {
    const files = cell.positions.map((file) => ({
      name: basename(file),
      text: read(join(dir, file)),
    }));
    const saved = await importPositionsFiles(scopedFor(user.id, client), files, { now });
    if (!saved.ok) throw new Error(`${dir}: positions: ${saved.error}`);
  }
  for (const account of cell.accounts) {
    const form = new FormData();
    form.set("accountId", "new");
    form.set("new.name", account.name);
    form.set("new.kind", account.kind);
    if (account.balance) form.set("new.balance", account.balance);
    for (const file of account.files) {
      form.append("files", new File([read(join(dir, file))], basename(file), { type: "text/csv" }));
    }
    const saved = await saveUpload(scopedFor(user.id, client), form, { client });
    if (!saved.ok) throw new Error(`${dir}: ${account.name}: ${saved.error}`);
    await finishImport(user.id, saved.runId, { client, now });
  }
  return user.id;
}
