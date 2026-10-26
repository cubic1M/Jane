import type { Instrumentation } from "next";

// Records every server error, scrubbed, for /admin/errors (see src/lib/error-log.ts), and emails
// the team about it, throttled (src/lib/error-alerts.ts).
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ describeError, recordError }, { alertError }, { db }] = await Promise.all([
    import("@/lib/error-log"),
    import("@/lib/error-alerts"),
    import("@/lib/db"),
  ]);
  await recordError(
    error,
    { path: request.path, method: request.method, routeType: context.routeType },
    db,
  );
  // And the team hears, at most once an hour per kind (src/lib/error-alerts.ts).
  await alertError({ message: describeError(error).message, path: request.path }, { client: db });
};
