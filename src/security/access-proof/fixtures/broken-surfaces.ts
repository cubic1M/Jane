import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

// Deliberately broken ways in, with the mistakes this suite exists to catch. The attack runs against
// these on every run and must fail each one: if it ever stops noticing, the proof fails too. Nothing
// in the app imports this file, and it isn't under src/app, so it has no URL.

// Checks who's asking, then reads by the id it was given without asking whose it is.
export async function readsAnyonesRow(formData: FormData) {
  await requireUser();
  return db.account.findUnique({ where: { id: String(formData.get("accountId")) } });
}

// The same mistake, on a write.
export async function writesAnyonesRow(formData: FormData) {
  await requireUser();
  await db.account.updateMany({
    where: { id: String(formData.get("accountId")) },
    data: { name: "changed by someone else" },
  });
  return { ok: true };
}

// No check at all.
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("accountId") ?? "";
  return NextResponse.json(await db.account.findUnique({ where: { id } }));
}
