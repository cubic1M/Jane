import type { Instrumentation } from "next";

const REFUSED_ACTION = "Invalid Server Actions request";

// Records every server error, scrubbed, for /admin/errors (see src/lib/error-log.ts), and emails
// the team about it, throttled (src/lib/error-alerts.ts).
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ describeError, recordError }, { alertError }, { db }, { hit }] = await Promise.all([
    import("@/lib/error-log"),
    import("@/lib/error-alerts"),
    import("@/lib/db"),
    import("@/lib/rate-limit"),
  ]);
  // Anyone can post a server action from another site, on any path: Next.js refuses it with this
  // error. It gets its own small allowance and one alert, not one per path, so a flood of them can't
  // use up what real errors need.
  const refused = error instanceof Error && error.message.includes(REFUSED_ACTION);
  // Only so many are kept an hour. If the count itself fails, the error is still kept.
  const kept = await hit(refused ? "refusedActionsKept" : "serverErrorsKept", "all", {
    client: db,
  }).catch(() => ({ ok: true }));
  if (!kept.ok) {
    // Real errors past the ceiling go unrecorded, so the team hears that they're going unrecorded.
    if (!refused) {
      await alertError(
        { message: "ErrorFlood: more server errors than Jane keeps in an hour", path: null },
        { client: db, pastCeiling: true },
      );
    }
    return;
  }
  await recordError(
    error,
    { path: request.path, method: request.method, routeType: context.routeType },
    db,
  );
  // And the team hears, at most once an hour per kind (src/lib/error-alerts.ts).
  await alertError(
    { message: describeError(error).message, path: refused ? null : request.path },
    { client: db },
  );
};
