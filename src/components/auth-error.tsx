import { authErrorMessage } from "@/lib/auth-errors";

// The ?error= message on /login and /signup.
export async function AuthError({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const message = authErrorMessage((await searchParams).error);
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
    >
      {message}
    </p>
  );
}
