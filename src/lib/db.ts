import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { rlsPool } from "@/lib/rls-pg";

// Reuse one client across hot reloads in dev so connections don't pile up.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // pg's pool, sending each scoped query in one round trip (src/lib/rls-pg.ts).
    adapter: new PrismaPg(rlsPool(process.env.DATABASE_URL)),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
