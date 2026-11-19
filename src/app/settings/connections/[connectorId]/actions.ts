"use server";

import { notFound, redirect } from "next/navigation";
import { connectorsOn } from "@/config/connectors";
import { declineConnect, safeReturnPath, startConnect } from "@/lib/connectors/connect";
import { ConsentError } from "@/lib/connectors/consent";
import { requireUser } from "@/lib/session";

// The consent screen's two answers (src/lib/connectors/connect.ts), always for the signed-in person.

export async function connectNow(formData: FormData): Promise<void> {
  if (!connectorsOn()) notFound();
  const user = await requireUser();
  const connectorId = String(formData.get("connectorId") ?? "");
  const back = safeReturnPath(formData.get("from"));
  let next: Awaited<ReturnType<typeof startConnect>>;
  try {
    next = await startConnect(user.id, connectorId, {
      returnUrl: `/settings/connections/${encodeURIComponent(connectorId)}/return?from=${encodeURIComponent(back)}`,
    });
  } catch (error) {
    if (!(error instanceof ConsentError)) throw error;
    redirect(
      `/settings/connections/${encodeURIComponent(connectorId)}?from=${encodeURIComponent(back)}`,
    );
  }
  redirect(
    next.next === "partner"
      ? next.redirectUrl
      : `${back}${back.includes("?") ? "&" : "?"}connected=${encodeURIComponent(connectorId)}`,
  );
}

export async function notNow(formData: FormData): Promise<void> {
  if (!connectorsOn()) notFound();
  const user = await requireUser();
  await declineConnect(user.id, String(formData.get("connectorId") ?? ""));
  redirect(safeReturnPath(formData.get("from")));
}
