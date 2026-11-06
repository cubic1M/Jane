"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { connectorsOn } from "@/config/connectors";
import { ConsentError, grantConsent, revokeConsent } from "@/lib/connectors/consent";
import { requireUser } from "@/lib/session";

// Connections (/settings/connections): allowing a connector the scopes it asks for, or revoking
// that, always for the signed-in person (the helpers scope to them and log each to the audit log).
// Off, like the page, unless CONNECTORS=1.

export async function allowConnector(formData: FormData): Promise<void> {
  if (!connectorsOn()) notFound();
  const user = await requireUser();
  const connectorId = String(formData.get("connectorId") ?? "");
  const scopes = formData.getAll("scope").map(String);
  try {
    await grantConsent(user.id, connectorId, scopes);
  } catch (error) {
    // Nothing granted; the page shows what is still allowed.
    if (!(error instanceof ConsentError)) throw error;
  }
  revalidatePath("/settings/connections");
}

export async function revokeConnector(formData: FormData): Promise<void> {
  if (!connectorsOn()) notFound();
  const user = await requireUser();
  await revokeConsent(user.id, String(formData.get("connectorId") ?? ""));
  revalidatePath("/settings/connections");
}
