import { Prisma } from "@/generated/prisma/client";

// An upsert on a unique key, safe when two requests run it at once: both can find no row
// and both try to create it, so the one that loses runs again and updates.
export async function upsertOnce<T>(save: () => Promise<T>): Promise<T> {
  try {
    return await save();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return save();
    }
    throw error;
  }
}
