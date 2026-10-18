"use server";

import { revalidatePath } from "next/cache";
import { MAX_TEAM_TEXT } from "@/config/concierge";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

export type ReplyState = { ok: boolean; message: string } | null;

const TITLE_LENGTH = 80;

export async function saveReply(_previous: ReplyState, formData: FormData): Promise<ReplyState> {
  const admin = await requireAdmin();
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!title || title.length > TITLE_LENGTH) {
    return { ok: false, message: `Give it a short title (up to ${TITLE_LENGTH} characters).` };
  }
  if (!body || body.length > MAX_TEAM_TEXT) {
    return { ok: false, message: `Write the reply (up to ${MAX_TEAM_TEXT} characters).` };
  }
  const id = String(formData.get("id") ?? "");
  const saved = id
    ? await db.savedReply.update({ where: { id }, data: { title, body }, select: { id: true } })
    : await db.savedReply.create({ data: { title, body }, select: { id: true } });
  await logAudit(
    { type: "admin", id: admin.id },
    "saved_reply_saved",
    {
      type: "saved_reply",
      id: saved.id,
    },
    {},
  );
  revalidatePath("/admin/replies");
  return { ok: true, message: "Saved." };
}

export async function deleteReply(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const { count } = await db.savedReply.deleteMany({ where: { id } });
  if (count > 0) {
    await logAudit(
      { type: "admin", id: admin.id },
      "saved_reply_deleted",
      {
        type: "saved_reply",
        id,
      },
      {},
    );
  }
  revalidatePath("/admin/replies");
}
