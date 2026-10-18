import type { PrismaClient } from "@/generated/prisma/client";
import { scrub, scrubPath } from "@/lib/scrub";

// Error monitoring without a third-party service: server errors are scrubbed and stored
// in error_events (viewable at /admin/errors), and a scrubbed line goes to the logs.

const MAX_MESSAGE = 1000;
const MAX_STACK = 4000;

export type RequestErrorContext = {
  path?: string;
  method?: string;
  routeType?: string;
};

export function describeError(error: unknown) {
  const err = error instanceof Error ? error : new Error(String(error));
  const digest =
    typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : null;
  return {
    message: scrub(`${err.name}: ${err.message}`).slice(0, MAX_MESSAGE),
    stack: err.stack ? scrub(err.stack).slice(0, MAX_STACK) : null,
    digest,
  };
}

export async function recordError(
  error: unknown,
  context: RequestErrorContext,
  client: PrismaClient,
): Promise<void> {
  const described = describeError(error);
  const path = scrubPath(context.path);
  console.error("Request error", {
    message: described.message,
    path,
    routeType: context.routeType,
  });
  try {
    await client.errorEvent.create({
      data: {
        ...described,
        path,
        method: context.method ?? null,
        routeType: context.routeType ?? null,
      },
    });
  } catch {
    // Never let error logging cause another error.
  }
}
