"use server";

import { redirect } from "next/navigation";
import { cleanReport } from "@/lib/problem-reports";
import { hit } from "@/lib/rate-limit";
import { requireUser } from "@/lib/session";
import { saveTryFeedback } from "@/lib/try-feedback";
import { isTrialUser } from "@/lib/trial-ids";

// "What did Jane get wrong?" during a try. A plain form, so the page sends no more JavaScript: the
// answer comes back as ?feedback= on the page it came from (src/components/try-feedback-box.tsx).
export async function sendTryFeedback(formData: FormData): Promise<void> {
  const user = await requireUser();
  const from = formData.get("from") === "/report" ? "/report" : "/home";
  if (!isTrialUser(user.id)) redirect(from);
  if (!(await hit("tryFeedback", user.id)).ok || !(await hit("tryFeedbackDay", "all")).ok) {
    redirect(`${from}?feedback=busy`);
  }
  const feedback = cleanReport(from, formData.get("message"));
  if (typeof feedback === "string") redirect(`${from}?feedback=empty`);
  await saveTryFeedback(user.id, feedback);
  redirect(`${from}?feedback=sent`);
}
