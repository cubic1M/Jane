import { type SwitchTier, type KillSwitch, rememberStoredSwitches } from "@/config/kill-switches";
import { OPS_SWITCH_CACHE_MS, OPS_SWITCH_READ_TIMEOUT_MS } from "@/config/health";
import type { PrismaClient } from "@/generated/prisma/client";
import { log } from "@/lib/log";

// Emergency switches that apply in seconds, with no deploy, and survive a rollback (docs/incident.md).
// Off unless OPS_SWITCHES=1: then this reads nothing, adds nothing, and only the environment
// variables count. `db` is imported only when it's on, so a client that never needs a database
// doesn't load one for this.
const WHY = "The emergency switches apply to everyone, so they belong to no one person";

let readAt = 0;
let reading: Promise<void> | null = null;

async function systemClient(client?: PrismaClient) {
  const { systemDb } = await import("@/lib/system-db");
  return systemDb(WHY, client);
}

async function read(client?: PrismaClient): Promise<void> {
  try {
    const rows = await (await systemClient(client)).opsSwitch.findMany({ where: { on: true } });
    rememberStoredSwitches(rows.map((row) => row.name));
    readAt = Date.now();
  } catch (error) {
    // Keep what it last knew: a database that's down isn't a reason to lift a stop. Try again soon.
    readAt = Date.now() - OPS_SWITCH_CACHE_MS + 1000;
    log.warn("Ops switches: read failed", { error });
  }
}

// Brings the switches up to date, at most once per OPS_SWITCH_CACHE_MS. Never throws, and never
// holds a request longer than the timeout: the read carries on behind it.
export async function freshSwitches({ client }: { client?: PrismaClient } = {}): Promise<void> {
  if (process.env.OPS_SWITCHES !== "1") return;
  if (Date.now() - readAt < OPS_SWITCH_CACHE_MS) return;
  reading ??= read(client).finally(() => {
    reading = null;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    reading,
    new Promise((resolve) => {
      timer = setTimeout(resolve, OPS_SWITCH_READ_TIMEOUT_MS);
    }),
  ]);
  clearTimeout(timer);
}

export function forgetSwitchesForTests(): void {
  readAt = 0;
  reading = null;
  rememberStoredSwitches([]);
}

// Sets one switch. Says whether that changed anything, so a repeat is harmless and quiet.
export async function setSwitch(
  name: KillSwitch,
  on: boolean,
  {
    tier,
    trigger,
    client,
    now = new Date(),
  }: { tier: SwitchTier; trigger: string; client?: PrismaClient; now?: Date },
): Promise<boolean> {
  const system = await systemClient(client);
  const before = await system.opsSwitch.findUnique({ where: { name } });
  if ((before?.on ?? false) === on) return false;
  await system.opsSwitch.upsert({
    where: { name },
    create: { name, on, setBy: tier, trigger, setAt: now },
    update: { on, setBy: tier, trigger, setAt: now },
  });
  readAt = 0;
  return true;
}

export async function switchesOn({ client }: { client?: PrismaClient } = {}): Promise<string[]> {
  const rows = await (await systemClient(client)).opsSwitch.findMany({ where: { on: true } });
  return rows.map((row) => row.name).toSorted();
}
