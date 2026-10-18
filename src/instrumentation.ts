import type { Instrumentation } from "next";

// Records every server error, scrubbed, for /admin/errors (see src/lib/error-log.ts).
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ recordError }, { db }] = await Promise.all([
    import("@/lib/error-log"),
    import("@/lib/db"),
  ]);
  await recordError(
    error,
    { path: request.path, method: request.method, routeType: context.routeType },
    db,
  );
};
