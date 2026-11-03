import { createHash, timingSafeEqual } from "node:crypto";

// Whether a request carries the cron secret Vercel sends. Compared by hash in constant time, so how
// long a wrong guess takes says nothing about how close it was. No secret set: nobody passes.
export function cronAuthorized(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const digest = (text: string) => createHash("sha256").update(text).digest();
  return timingSafeEqual(
    digest(request.headers.get("authorization") ?? ""),
    digest(`Bearer ${secret}`),
  );
}
