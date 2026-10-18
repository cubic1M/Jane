"use server";

import { redirect } from "next/navigation";
import { acceptTerms } from "@/lib/terms";
import { HOME_PATH, getCurrentUser } from "@/lib/session";

export async function acceptCurrentTerms(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (formData.get("consent") !== "on") redirect("/terms/accept?error=ConsentRequired");
  await acceptTerms(user.id, { via: "prompt" });
  redirect(HOME_PATH);
}
