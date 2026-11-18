import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { ConsentError, consentCovers, usableConnector } from "./consent";
import type { ReadResult } from "./types";

// A read connector bringing the person's data in (read connectors, 11-18): only when the
// connector is usable for this person now (the locks, who they are: whyUnavailable) and their
// current consent covers every scope it asks for. The connector saves into Jane's own tables, so
// the findings that already read them (a renewal reshop, a tax form) work unchanged.

export class ReadRefused extends Error {
  constructor(readonly reason: "not_a_reader" | "no_consent") {
    super(
      reason === "no_consent"
        ? "No consent for that connection."
        : "That connection reads nothing.",
    );
    this.name = "ReadRefused";
  }
}

type Options = { client?: PrismaClient; now?: Date };

export async function readConnector(
  userId: string,
  connectorId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<ReadResult> {
  // Throws ConsentError with why it isn't available (off, switched off, trial, sample data).
  const connector = await usableConnector(userId, connectorId, { client });
  if (!connector.read || !connector.capabilities.includes("read")) {
    throw new ReadRefused("not_a_reader");
  }
  if (!(await consentCovers(userId, connector, { client }))) throw new ReadRefused("no_consent");
  const result = await connector.read({ userId, client, now });
  await logAudit(
    { type: "user", id: userId },
    "connector_data_read",
    { type: "user", id: userId },
    { connector: connector.id, saved: result.saved },
  );
  await track(userId, "connector_data_read", { connector: connector.id, saved: result.saved });
  return result;
}

// After a consent or a partner's "fresh data": reads when the connector reads, and stays quiet when
// it can't (not one, not available, no consent), since nothing was asked of the person.
export async function readIfReader(
  userId: string,
  connectorId: string,
  options: Options = {},
): Promise<ReadResult | null> {
  try {
    return await readConnector(userId, connectorId, options);
  } catch (error) {
    if (error instanceof ReadRefused || error instanceof ConsentError) return null;
    throw error;
  }
}
