"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { connectorsOn } from "@/config/connectors";
import { ConsentError, grantConsent, revokeConsent } from "@/lib/connectors/consent";
import { ConnectorRefused, answerAction, cancelAction } from "@/lib/connectors/pipeline";
import { requireUser } from "@/lib/session";

// Connections (/settings/connections): allowing a connector the scopes it asks for or revoking that,
// and answering or cancelling an action through one, always for the signed-in person (the helpers
// scope to them and log each to the audit log). Off, like the page, unless CONNECTORS=1; cancelling
// always works.

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

// The person's answer on one action. A yes carries the amount and fingerprint the card showed, so it
// counts only for exactly that (src/lib/connectors/pipeline.ts).
export async function answerConnectorAction(formData: FormData): Promise<void> {
  if (!connectorsOn()) notFound();
  const user = await requireUser();
  const actionId = String(formData.get("actionId") ?? "");
  const yes = formData.get("answer") === "yes";
  try {
    await answerAction(
      user.id,
      actionId,
      yes
        ? {
            yes: true,
            amountCents: Number(formData.get("amountCents")),
            fingerprint: String(formData.get("fingerprint") ?? ""),
          }
        : { yes: false },
    );
  } catch (error) {
    // Refused: nothing changed, and the page shows where it stands.
    if (!(error instanceof ConnectorRefused)) throw error;
  }
  revalidatePath("/settings/connections");
}

export async function cancelConnectorAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  // Cancelling works whatever the flags say, so a person can always take something back.
  await cancelAction(user.id, String(formData.get("actionId") ?? ""));
  revalidatePath("/settings/connections");
}
