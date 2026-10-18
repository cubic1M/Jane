import { HOME_PATH } from "@/config/home";

// Where to go after the code: a path inside this app only, so the form can't send anyone
// to another site. "//evil.example" and "/\\evil" don't pass.
export function safeNext(value: unknown, role: "user" | "admin"): string {
  if (typeof value === "string" && /^\/(?!\/)[\w/#-]*$/.test(value)) return value;
  return role === "admin" ? "/admin/queue" : HOME_PATH;
}
