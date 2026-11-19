import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { systemDb } from "@/lib/system-db";
import { VENDOR_CHECKS } from "./env-check";
import { allConnectors, whyUnavailable, type Unavailable } from "./registry";

// The admin's view of every connector (section C5, /admin/connectors), like "what Plaid granted":
// who it's open to (from the same locks the app uses), whether its key names are set (names only,
// never a value), and its last good read and last failure across everyone. Counts and times only.

const WHY =
  "Admin connector status: counts and times across people, behind ADMIN_EMAILS and two-factor";

export type ConnectorStatus = {
  id: string;
  name: string;
  sandbox: boolean;
  // Who it's open to now: null when open, else why not (whyUnavailable's reason).
  realPeople: Unavailable | null;
  samplePeople: Unavailable | null;
  // Its vendor's key names, set or missing; empty for one with no vendor key.
  keys: { name: string; set: boolean }[];
  connected: number;
  lastRead: Date | null;
  lastFailure: { at: Date; reason: string } | null;
};

// The vendor whose keys a connector reads, by its id.
const VENDOR_OF: Record<string, string> = {
  method: "Method",
  snaptrade: "SnapTrade",
  pinwheel: "Pinwheel",
  postgrid: "PostGrid",
  canopy: "Canopy",
  chart: "Chart",
  signwell: "SignWell",
  alpaca: "Alpaca (broker sandbox)",
};

function vendorKeys(id: string, env: Record<string, string | undefined>) {
  const vendor = Object.entries(VENDOR_OF).find(([part]) => id.includes(part))?.[1];
  const check = VENDOR_CHECKS.find((c) => c.vendor === vendor);
  return (check?.keys ?? []).map((name) => ({ name, set: Boolean(env[name]?.trim()) }));
}

export async function connectorStatus({
  client = defaultClient,
  env = process.env,
}: { client?: PrismaClient; env?: Record<string, string | undefined> } = {}): Promise<
  ConnectorStatus[]
> {
  const db = systemDb(WHY, client);
  const [consents, reads, failures] = await Promise.all([
    db.connectorConsent.groupBy({
      by: ["connectorId"],
      where: { revokedAt: null },
      _count: { _all: true },
    }),
    db.auditLog.findMany({
      where: { event: "connector_data_read" },
      orderBy: { createdAt: "desc" },
      take: 1000,
      select: { metadata: true, createdAt: true },
    }),
    db.connectorAction.findMany({
      where: { status: { in: ["failed", "refused"] } },
      orderBy: { updatedAt: "desc" },
      take: 500,
      select: { connectorId: true, reason: true, updatedAt: true },
    }),
  ]);
  const lastRead = new Map<string, Date>();
  for (const read of reads) {
    const id = (read.metadata as { connector?: unknown } | null)?.connector;
    if (typeof id === "string" && !lastRead.has(id)) lastRead.set(id, read.createdAt);
  }
  return allConnectors().map((c) => {
    const failure = failures.find((f) => f.connectorId === c.id);
    return {
      id: c.id,
      name: c.name,
      sandbox: c.sandbox,
      realPeople: whyUnavailable(c, { userId: "status_real", sampleData: false }, env),
      samplePeople: whyUnavailable(c, { userId: "status_sample", sampleData: true }, env),
      keys: vendorKeys(c.id, env),
      connected: consents.find((row) => row.connectorId === c.id)?._count._all ?? 0,
      lastRead: lastRead.get(c.id) ?? null,
      lastFailure: failure ? { at: failure.updatedAt, reason: failure.reason ?? "failed" } : null,
    };
  });
}
