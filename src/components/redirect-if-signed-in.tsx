import { redirect } from "next/navigation";
import { getCurrentUser, HOME_PATH } from "@/lib/session";

// Render inside <Suspense>: it reads the session cookie.
export async function RedirectIfSignedIn() {
  if (await getCurrentUser()) redirect(HOME_PATH);
  return null;
}
