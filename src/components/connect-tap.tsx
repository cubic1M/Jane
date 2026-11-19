import Link from "next/link";
import { connectOffered } from "@/lib/connectors/connect";

// The one tap a card shows to connect what it needs (src/lib/connectors/connect.ts). Given the real
// connector and its sandbox twin, it offers the first one this person may use now, and nothing when
// connectors are off, none is for them, it's connected or they said "Not now". Opens the shared
// consent screen and comes back to `from`. The card must make sense without it. Never in sign-up or
// onboarding (src/app/onboarding-no-connectors.test.ts).

export async function ConnectTap({
  userId,
  connectorIds,
  from,
  label,
}: {
  userId: string;
  connectorIds: readonly string[];
  // The page to come back to.
  from: string;
  // What connecting gets the person, in the card's words ("Bring in the account itself").
  label: string;
}) {
  for (const connectorId of connectorIds) {
    if (!(await connectOffered(userId, connectorId))) continue;
    return (
      <Link
        href={`/settings/connections/${encodeURIComponent(connectorId)}?from=${encodeURIComponent(from)}`}
        data-connect={connectorId}
        className="inline-flex min-h-11 items-center self-start text-sm font-medium underline underline-offset-2 hover:no-underline"
      >
        {label}
      </Link>
    );
  }
  return null;
}
