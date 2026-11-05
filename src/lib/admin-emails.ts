// ADMIN_EMAILS: who the team is. Its own small file so the proxy can read it on every /admin request.

const list = () =>
  (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

export function isAdminEmail(email: string): boolean {
  return list().includes(email.toLowerCase());
}

// Whether this admin is still on the list. With no list at all in local runs and tests, the role in
// the database is all there is; in production that's a setting gone missing, so nobody is. Taking
// someone off the list has to end their access: their role is only ever raised, on sign-in.
export function stillAnAdmin(email: string | null | undefined): boolean {
  const team = list();
  if (team.length === 0) return process.env.NODE_ENV !== "production";
  return team.includes((email ?? "").toLowerCase());
}
