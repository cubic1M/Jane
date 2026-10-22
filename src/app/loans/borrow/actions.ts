"use server";

import { redirect } from "next/navigation";
import { checkBorrowing } from "@/lib/borrowing-power";
import { requireUser } from "@/lib/session";

// On /loans/borrow (spec step 250): "Check again" runs the soft checks now. Soft checks never
// touch the score; nothing here applies for anything.

export async function checkAgainAction(): Promise<void> {
  const user = await requireUser();
  const done = await checkBorrowing(user.id);
  redirect(done ? "/loans/borrow?checked=1" : "/loans/borrow");
}
