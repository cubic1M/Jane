"use server";

import { redirect } from "next/navigation";
import { rotateKeys } from "@/lib/key-rotation";
import { requireAdmin } from "@/lib/session";

// One run must finish inside a web request; the page says to press again if it ran out.
const TIME_BUDGET_MS = 20_000;

export async function rotateNow(): Promise<void> {
  const admin = await requireAdmin();
  let query: string;
  try {
    const result = await rotateKeys(
      { type: "admin", id: admin.id },
      { deadline: Date.now() + TIME_BUDGET_MS },
    );
    query = new URLSearchParams({
      rotated: String(result.rotated),
      failed: String(result.failed),
      done: result.done ? "1" : "0",
    }).toString();
  } catch {
    // The current key isn't usable; the page lists what's wrong (names only).
    query = "error=1";
  }
  redirect(`/admin/keys?${query}`);
}
