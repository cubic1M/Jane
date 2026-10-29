import { redirect } from "next/navigation";
import { connection } from "next/server";
import { previousMonth } from "@/insights/check-in";
import { requireUser } from "@/lib/session";
import { todayOf } from "@/lib/today";

// The monthly close with no month asked for: the month just ended, as a controller closes it.
export default async function ClosePage() {
  const user = await requireUser();
  await connection();
  redirect(`/close/${previousMonth(await todayOf(user.id))}`);
}
